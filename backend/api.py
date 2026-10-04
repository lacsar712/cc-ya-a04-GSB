import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from psycopg.errors import UniqueViolation
from quart import Quart, jsonify, request

from db import MIGRATIONS, SCHEMA, connect
from rules import cross_check, judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    conn.execute(MIGRATIONS)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", "ENC-W01-A", "ENC-W01-B", 0.4, 0.4, 1.0, "合格"),
        ("W07", "ENC-W07-A", "ENC-W07-B", 3.2, 3.2, 1.0, "偏航超差"),
    ]
    for (
        code,
        primary_code,
        backup_code,
        primary_err,
        backup_err,
        threshold,
        expected_verdict,
    ) in samples:
        avg, diff, reject_reason = cross_check(primary_err, backup_err, threshold)
        assert reject_reason is None
        verdict, reason = judge(avg)
        assert verdict == expected_verdict
        binding = conn.execute(
            """INSERT INTO encoder_bindings
               (turbine_code, primary_code, backup_code, diff_threshold_deg,
                created_by, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (code, primary_code, backup_code, threshold, "technician", now, now),
        ).fetchone()
        conn.execute(
            """INSERT INTO yaw_logs
               (binding_id, turbine_code, primary_code, backup_code,
                primary_err_deg, backup_err_deg, diff_deg, yaw_err_deg,
                diff_threshold_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'done', %s, %s, %s, %s, %s)""",
            (
                binding["id"], code, primary_code, backup_code,
                primary_err, backup_err, diff, avg, threshold,
                verdict, reason, "technician", now, now,
            ),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "观察员只读：不能登记/修改绑定，也不能报数"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


def parse_number(value, field):
    try:
        num = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field}必须是数字")
    if not math.isfinite(num):
        raise ValueError(f"{field}必须是有限数字")
    return num


BINDING_COLS = """id, turbine_code, primary_code, backup_code, diff_threshold_deg,
                  created_by, created_at, updated_at"""

LOG_COLS = """id, binding_id, turbine_code, primary_code, backup_code,
              primary_err_deg, backup_err_deg, diff_deg, yaw_err_deg,
              diff_threshold_deg, status, verdict, reason,
              created_by, created_at, processed_at"""


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/bindings")
@require_login
async def list_bindings(user):
    def query():
        with connect() as conn:
            return conn.execute(
                f"SELECT {BINDING_COLS} FROM encoder_bindings ORDER BY id"
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


def _read_binding_body(body):
    turbine_code = (body.get("turbine_code") or "").strip()
    primary_code = (body.get("primary_code") or "").strip()
    backup_code = (body.get("backup_code") or "").strip()
    if not turbine_code:
        return None, "机组编号不能为空"
    if not primary_code:
        return None, "主路编码器编号不能为空"
    if not backup_code:
        return None, "备路编码器编号不能为空"
    if primary_code == backup_code:
        return None, "主路与备路编码器编号不能相同"
    try:
        threshold = parse_number(body.get("diff_threshold_deg"), "主备差值门槛")
    except ValueError as exc:
        return None, str(exc)
    if threshold < 0:
        return None, "主备差值门槛不能为负"
    return {
        "turbine_code": turbine_code,
        "primary_code": primary_code,
        "backup_code": backup_code,
        "diff_threshold_deg": threshold,
    }, None


@app.post("/api/bindings")
@require_writer
async def create_binding(user):
    body = await request.get_json(force=True, silent=True) or {}
    data, error = _read_binding_body(body)
    if error:
        return jsonify({"detail": error}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            try:
                with conn.transaction():
                    return conn.execute(
                        """INSERT INTO encoder_bindings
                           (turbine_code, primary_code, backup_code,
                            diff_threshold_deg, created_by, created_at, updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)
                           RETURNING """ + BINDING_COLS,
                        (
                            data["turbine_code"],
                            data["primary_code"],
                            data["backup_code"],
                            data["diff_threshold_deg"],
                            user["username"],
                            now,
                            now,
                        ),
                    ).fetchone()
            except UniqueViolation:
                return "duplicate"

    result = await run_db(insert)
    if result == "duplicate":
        return jsonify({"detail": "机组编号/主路编号/备路编号已登记，请直接修改现有绑定"}), 409
    return jsonify(result), 201


@app.put("/api/bindings/<int:binding_id>")
@require_writer
async def update_binding(user, binding_id):
    body = await request.get_json(force=True, silent=True) or {}
    data, error = _read_binding_body(body)
    if error:
        return jsonify({"detail": error}), 400

    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            try:
                with conn.transaction():
                    return conn.execute(
                        """UPDATE encoder_bindings
                           SET turbine_code = %s,
                               primary_code = %s,
                               backup_code = %s,
                               diff_threshold_deg = %s,
                               updated_at = %s
                           WHERE id = %s
                           RETURNING """ + BINDING_COLS,
                        (
                            data["turbine_code"],
                            data["primary_code"],
                            data["backup_code"],
                            data["diff_threshold_deg"],
                            now,
                            binding_id,
                        ),
                    ).fetchone()
            except UniqueViolation:
                return "duplicate"

    result = await run_db(update)
    if result == "duplicate":
        return jsonify({"detail": "机组编号/主路编号/备路编号与其他登记冲突"}), 409
    if result is None:
        return jsonify({"detail": "绑定不存在"}), 404
    return jsonify(result)


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                f"SELECT {LOG_COLS} FROM yaw_logs ORDER BY id DESC"
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    try:
        binding_id = int(body.get("binding_id"))
    except (TypeError, ValueError):
        return jsonify({"detail": "请先选择主备绑定"}), 400
    try:
        primary_err = parse_number(body.get("primary_err_deg"), "主路偏航误差")
        backup_err = parse_number(body.get("backup_err_deg"), "备路偏航误差")
    except ValueError as exc:
        return jsonify({"detail": str(exc)}), 400

    now = datetime.now(timezone.utc)

    def submit():
        # 入队与绑定冻结并入同一笔事务：行锁读绑定 → 对拍 → 冻结快照写队列，一次提交。
        with connect() as conn:
            try:
                with conn.transaction():
                    binding = conn.execute(
                        """SELECT id, turbine_code, primary_code, backup_code,
                                  diff_threshold_deg
                           FROM encoder_bindings
                           WHERE id = %s
                           FOR UPDATE""",
                        (binding_id,),
                    ).fetchone()
                    if binding is None:
                        return {"kind": "error", "status": 400,
                                "detail": "绑定不存在或已删除"}

                    avg, diff, reject_reason = cross_check(
                        primary_err,
                        backup_err,
                        float(binding["diff_threshold_deg"]),
                    )
                    if reject_reason is not None:
                        # 双通道超差：整单退回，不留队列记录，仅登记拒收样例。
                        rejected = conn.execute(
                            """INSERT INTO rejected_submissions
                               (binding_id, turbine_code, primary_code, backup_code,
                                primary_err_deg, backup_err_deg, diff_deg,
                                diff_threshold_deg, reason, rejected_by, rejected_at)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                               RETURNING id""",
                            (
                                binding["id"], binding["turbine_code"],
                                binding["primary_code"], binding["backup_code"],
                                primary_err, backup_err, diff,
                                binding["diff_threshold_deg"], reject_reason,
                                user["username"], now,
                            ),
                        ).fetchone()
                        return {"kind": "rejected", "status": 400,
                                "detail": reject_reason,
                                "rejected_id": rejected["id"]}

                    row = conn.execute(
                        """INSERT INTO yaw_logs
                           (binding_id, turbine_code, primary_code, backup_code,
                            primary_err_deg, backup_err_deg, diff_deg, yaw_err_deg,
                            diff_threshold_deg, status, created_by, created_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                                   'pending', %s, %s)
                           RETURNING """ + LOG_COLS,
                        (
                            binding["id"], binding["turbine_code"],
                            binding["primary_code"], binding["backup_code"],
                            primary_err, backup_err, diff, avg,
                            binding["diff_threshold_deg"],
                            user["username"], now,
                        ),
                    ).fetchone()
                    return {"kind": "ok", "status": 201, "row": row}
            except UniqueViolation:
                # 部分唯一索引兜底：两人并发争抢同一绑定，至多一笔入队成功。
                return {"kind": "conflict", "status": 409,
                        "detail": "该绑定已有一笔待处理对拍记录，待其处理完成后再报"}

    result = await run_db(submit)
    kind = result.pop("kind")
    status = result.pop("status")
    if kind == "ok":
        return jsonify(result["row"]), status
    return jsonify(result), status


@app.get("/api/rejected")
@require_login
async def list_rejected(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, binding_id, turbine_code, primary_code, backup_code,
                          primary_err_deg, backup_err_deg, diff_deg,
                          diff_threshold_deg, reason, rejected_by, rejected_at
                   FROM rejected_submissions ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)
