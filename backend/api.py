import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import psycopg
from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import REJECT_VERDICT, cross_check, judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "technician2": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)

BINDING_COLS = """id, turbine_code, primary_channel, backup_channel, threshold_deg,
                  frozen_by_order_id,
                  (frozen_by_order_id IS NOT NULL) AS frozen,
                  created_by, created_at, updated_at"""

ORDER_COLS = """id, binding_id, turbine_code, primary_channel, backup_channel,
                threshold_deg, primary_err_deg, backup_err_deg, diff_deg,
                status, verdict, reason, created_by, created_at, processed_at"""


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_orders").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)

    def add_binding(turbine_code, primary_channel, backup_channel, threshold_deg):
        return conn.execute(
            """INSERT INTO encoder_bindings
               (turbine_code, primary_channel, backup_channel, threshold_deg,
                created_by, created_at, updated_at)
               VALUES (%s, %s, %s, %s, 'technician', %s, %s)
               RETURNING id""",
            (turbine_code, primary_channel, backup_channel, threshold_deg, now, now),
        ).fetchone()["id"]

    def add_order(binding_id, turbine_code, primary_channel, backup_channel,
                  threshold_deg, primary_err, backup_err):
        ok, diff, reason = cross_check(primary_err, backup_err, threshold_deg)
        if ok:
            status = "done"
            verdict, reason = judge(primary_err)
        else:
            status = "rejected"
            verdict = REJECT_VERDICT
        order_id = conn.execute(
            """INSERT INTO yaw_orders
               (binding_id, turbine_code, primary_channel, backup_channel,
                threshold_deg, primary_err_deg, backup_err_deg, diff_deg,
                status, verdict, reason, created_by, created_at, processed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       'technician', %s, %s)
               RETURNING id""",
            (binding_id, turbine_code, primary_channel, backup_channel,
             threshold_deg, primary_err, backup_err, diff,
             status, verdict, reason, now, now),
        ).fetchone()["id"]
        if status != "rejected":
            # 入队成功即随单冻结绑定；退回单不占用绑定
            conn.execute(
                """UPDATE encoder_bindings
                   SET frozen_by_order_id = %s, updated_at = %s
                   WHERE id = %s""",
                (order_id, now, binding_id),
            )
        return status, verdict

    b = add_binding("W01", "ENC-W01-P", "ENC-W01-B", 1.0)
    assert add_order(b, "W01", "ENC-W01-P", "ENC-W01-B", 1.0, 0.4, 0.5) == ("done", "合格")

    b = add_binding("W07", "ENC-W07-P", "ENC-W07-B", 1.0)
    assert add_order(b, "W07", "ENC-W07-P", "ENC-W07-B", 1.0, 3.2, 3.4) == ("done", "偏航超差")

    b = add_binding("W03", "ENC-W03-P", "ENC-W03-B", 1.0)
    assert add_order(b, "W03", "ENC-W03-P", "ENC-W03-B", 1.0, 0.6, 2.9) == ("rejected", "双通道超差")

    # W05 暂无工单，绑定保持可入队，便于现场直接下单
    add_binding("W05", "ENC-W05-P", "ENC-W05-B", 1.5)


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
            return jsonify({"detail": "观察员只读：不能登记/修改绑定，也不能提交工单"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


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


@app.post("/api/bindings")
@require_writer
async def create_binding(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    primary_channel = (body.get("primary_channel") or "").strip()
    backup_channel = (body.get("backup_channel") or "").strip()
    if not turbine_code or not primary_channel or not backup_channel:
        return jsonify({"detail": "机组编号、主路编号、备路编号均不能为空"}), 400
    try:
        threshold_deg = float(body.get("threshold_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "差值门槛必须是数字"}), 400
    if threshold_deg < 0:
        return jsonify({"detail": "差值门槛不能为负"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            try:
                with conn.transaction():
                    return conn.execute(
                        f"""INSERT INTO encoder_bindings
                            (turbine_code, primary_channel, backup_channel,
                             threshold_deg, created_by, created_at, updated_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            RETURNING {BINDING_COLS}""",
                        (turbine_code, primary_channel, backup_channel,
                         threshold_deg, user["username"], now, now),
                    ).fetchone(), None
            except psycopg.errors.UniqueViolation:
                return None, "duplicate"

    row, err = await run_db(insert)
    if err:
        return jsonify({"detail": f"机组 {turbine_code} 已登记主备绑定"}), 409
    return jsonify(row), 201


@app.put("/api/bindings/<int:binding_id>")
@require_writer
async def update_binding(user, binding_id):
    body = await request.get_json(force=True, silent=True) or {}
    primary_channel = (body.get("primary_channel") or "").strip()
    backup_channel = (body.get("backup_channel") or "").strip()
    if not primary_channel or not backup_channel:
        return jsonify({"detail": "主路编号、备路编号均不能为空"}), 400
    try:
        threshold_deg = float(body.get("threshold_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "差值门槛必须是数字"}), 400
    if threshold_deg < 0:
        return jsonify({"detail": "差值门槛不能为负"}), 400

    now = datetime.now(timezone.utc)

    def update():
        with connect() as conn:
            with conn.transaction():
                # 只改登记表本身；已冻结状态与旧工单快照列一律不动
                return conn.execute(
                    f"""UPDATE encoder_bindings
                        SET primary_channel = %s, backup_channel = %s,
                            threshold_deg = %s, updated_at = %s
                        WHERE id = %s
                        RETURNING {BINDING_COLS}""",
                    (primary_channel, backup_channel, threshold_deg, now, binding_id),
                ).fetchone()

    row = await run_db(update)
    if row is None:
        return jsonify({"detail": "绑定不存在"}), 404
    return jsonify(row)


@app.get("/api/orders")
@require_login
async def list_orders(user):
    def query():
        with connect() as conn:
            return conn.execute(
                f"SELECT {ORDER_COLS} FROM yaw_orders ORDER BY id DESC"
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/orders")
@require_writer
async def create_order(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        primary_err = float(body.get("primary_err_deg"))
        backup_err = float(body.get("backup_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "主备两路偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def submit():
        """入队与绑定冻结并入一笔事务：行锁串行化同一绑定的并发争抢。"""
        with connect() as conn:
            try:
                with conn.transaction():
                    binding = conn.execute(
                        """SELECT id, turbine_code, primary_channel, backup_channel,
                                  threshold_deg, frozen_by_order_id
                           FROM encoder_bindings
                           WHERE turbine_code = %s
                           FOR UPDATE""",
                        (turbine_code,),
                    ).fetchone()
                    if binding is None:
                        return "no_binding", None

                    ok, diff, reason = cross_check(
                        primary_err, backup_err, float(binding["threshold_deg"])
                    )
                    if not ok:
                        # 差值超门槛：整单退回并写明双通道超差；退回单不占用绑定
                        row = conn.execute(
                            f"""INSERT INTO yaw_orders
                                (binding_id, turbine_code, primary_channel,
                                 backup_channel, threshold_deg, primary_err_deg,
                                 backup_err_deg, diff_deg, status, verdict, reason,
                                 created_by, created_at, processed_at)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                                        'rejected', %s, %s, %s, %s, %s)
                                RETURNING {ORDER_COLS}""",
                            (binding["id"], binding["turbine_code"],
                             binding["primary_channel"], binding["backup_channel"],
                             binding["threshold_deg"], primary_err, backup_err,
                             diff, REJECT_VERDICT, reason,
                             user["username"], now, now),
                        ).fetchone()
                        return "rejected", row

                    if binding["frozen_by_order_id"] is not None:
                        # 绑定已随既有工单冻结，争抢失败
                        return "frozen", None

                    # 主备绑定关系随单冻结：快照列写入工单，同事务冻结绑定
                    row = conn.execute(
                        f"""INSERT INTO yaw_orders
                            (binding_id, turbine_code, primary_channel,
                             backup_channel, threshold_deg, primary_err_deg,
                             backup_err_deg, diff_deg, status, verdict, reason,
                             created_by, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                                    'pending', NULL, NULL, %s, %s)
                            RETURNING {ORDER_COLS}""",
                        (binding["id"], binding["turbine_code"],
                         binding["primary_channel"], binding["backup_channel"],
                         binding["threshold_deg"], primary_err, backup_err,
                         diff, user["username"], now),
                    ).fetchone()
                    conn.execute(
                        """UPDATE encoder_bindings
                           SET frozen_by_order_id = %s, updated_at = %s
                           WHERE id = %s""",
                        (row["id"], now, binding["id"]),
                    )
                    return "enqueued", row
            except psycopg.errors.UniqueViolation:
                # 兜底：同一绑定并发插入待处理单，至多一笔成功
                return "frozen", None

    outcome, row = await run_db(submit)
    if outcome == "no_binding":
        return jsonify(
            {"detail": f"机组 {turbine_code} 尚未登记主备绑定，请先到入队台专页登记"}
        ), 400
    if outcome == "frozen":
        return jsonify(
            {"detail": f"机组 {turbine_code} 的主备绑定已随既有工单冻结，本次入队失败"}
        ), 409
    return jsonify(row), 201
