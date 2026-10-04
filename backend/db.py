import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
-- 主备编码器绑定登记表（顶栏专页维护）
CREATE TABLE IF NOT EXISTS encoder_bindings (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL UNIQUE,
    primary_code text NOT NULL UNIQUE,
    backup_code text NOT NULL UNIQUE,
    diff_threshold_deg double precision NOT NULL CHECK (diff_threshold_deg >= 0),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

-- 对拍入队记录：binding_id 为外键，但主备编号/门槛/读数/差值全部随单冻结，
-- 事后改登记表改不了旧单。
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    binding_id integer REFERENCES encoder_bindings(id),
    turbine_code text NOT NULL,
    primary_code text NOT NULL,
    backup_code text NOT NULL,
    primary_err_deg double precision NOT NULL,
    backup_err_deg double precision NOT NULL,
    diff_deg double precision NOT NULL,
    yaw_err_deg double precision NOT NULL,
    diff_threshold_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

-- 同一绑定至多一笔待处理记录：并发两人争抢同一绑定，至多一笔成功。
CREATE UNIQUE INDEX IF NOT EXISTS yaw_logs_one_pending_per_binding
    ON yaw_logs (binding_id)
    WHERE status = 'pending';

-- 双通道超差拒收样例（整单退回，未入队）
CREATE TABLE IF NOT EXISTS rejected_submissions (
    id serial PRIMARY KEY,
    binding_id integer,
    turbine_code text NOT NULL,
    primary_code text NOT NULL,
    backup_code text NOT NULL,
    primary_err_deg double precision NOT NULL,
    backup_err_deg double precision NOT NULL,
    diff_deg double precision NOT NULL,
    diff_threshold_deg double precision NOT NULL,
    reason text NOT NULL,
    rejected_by text NOT NULL,
    rejected_at timestamptz NOT NULL
);
"""

# 旧版本数据卷（yaw_logs 只有单通道列）的幂等迁移；新库均为空操作。
MIGRATIONS = """
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS binding_id integer;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS primary_code text;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS backup_code text;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS primary_err_deg double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS backup_err_deg double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS diff_deg double precision;
ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS diff_threshold_deg double precision;
"""
