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
-- 主备编码器绑定登记表：一台机组绑定一对主/备通道与差值门槛。
-- frozen_by_order_id 非空表示该绑定已随单冻结，不再放行新工单。
CREATE TABLE IF NOT EXISTS encoder_bindings (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL UNIQUE,
    primary_channel text NOT NULL,
    backup_channel text NOT NULL,
    threshold_deg double precision NOT NULL,
    frozen_by_order_id integer,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

-- 对中工单：主备绑定关系随单冻结（快照列），事后改登记表不影响旧单。
CREATE TABLE IF NOT EXISTS yaw_orders (
    id serial PRIMARY KEY,
    binding_id integer NOT NULL REFERENCES encoder_bindings(id),
    turbine_code text NOT NULL,
    primary_channel text NOT NULL,
    backup_channel text NOT NULL,
    threshold_deg double precision NOT NULL,
    primary_err_deg double precision NOT NULL,
    backup_err_deg double precision NOT NULL,
    diff_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

-- 同一绑定至多一条待处理工单：并发争抢兜底约束（应用层另有行锁）。
CREATE UNIQUE INDEX IF NOT EXISTS yaw_orders_one_pending_per_binding
    ON yaw_orders (binding_id) WHERE status = 'pending';
"""
