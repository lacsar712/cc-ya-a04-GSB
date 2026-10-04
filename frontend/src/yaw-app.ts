import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type Binding = {
  id: number;
  turbine_code: string;
  primary_channel: string;
  backup_channel: string;
  threshold_deg: number;
  frozen: boolean;
  frozen_by_order_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type OrderRow = {
  id: number;
  binding_id: number;
  turbine_code: string;
  primary_channel: string;
  backup_channel: string;
  threshold_deg: number;
  primary_err_deg: number;
  backup_err_deg: number;
  diff_deg: number;
  status: string; // pending | done | rejected
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type View = "logs" | "station";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      padding: 0.75rem 1.5rem;
      background: #0b1220;
      border-bottom: 1px solid #334155;
    }
    .brand {
      font-size: 1.15rem;
      font-weight: 700;
      color: #38bdf8;
      white-space: nowrap;
    }
    nav {
      display: flex;
      gap: 0.5rem;
      flex: 1;
      flex-wrap: wrap;
    }
    nav button {
      background: transparent;
      color: #cbd5e1;
      border: 1px solid #334155;
      font-weight: 600;
    }
    nav button.active {
      background: #0284c7;
      border-color: #0284c7;
      color: #fff;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      color: #94a3b8;
      font-size: 0.9rem;
      white-space: nowrap;
    }
    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.5rem;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
    }
    .sub {
      color: #94a3b8;
      margin: 0 0 1.25rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    input:disabled {
      opacity: 0.6;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      white-space: nowrap;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .notice {
      color: #86efac;
      margin-top: 0.5rem;
    }
    .warn {
      color: #fca5a5;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0.25rem 0 0.75rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0 0.75rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "logs";
  @state() private orders: OrderRow[] = [];
  @state() private bindings: Binding[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private primaryErr = "";
  @state() private backupErr = "";
  @state() private bindTurbine = "";
  @state() private bindPrimary = "";
  @state() private bindBackup = "";
  @state() private bindThreshold = "";
  @state() private editingBindingId: number | null = null;
  @state() private error = "";
  @state() private notice = "";
  @state() private loading = false;

  private _pollTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshAll();
        this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refreshAll() {
    if (!this.session) return;
    await Promise.all([this.refreshOrders(), this.refreshBindings()]);
  }

  private async refreshOrders() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/orders", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.orders = (await res.json()) as OrderRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshBindings() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/bindings", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.bindings = (await res.json()) as Binding[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.refreshAll();
      this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.orders = [];
    this.bindings = [];
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private switchView(view: View) {
    this.view = view;
    this.error = "";
    this.notice = "";
  }

  private async submitOrder() {
    this.error = "";
    this.notice = "";
    this.loading = true;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          primary_err_deg: Number(this.primaryErr),
          backup_err_deg: Number(this.backupErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      if (data.status === "rejected") {
        this.notice = "";
        this.error = `整单退回：${data.verdict}（${data.reason ?? ""}）`;
      } else {
        this.notice = `工单 #${data.id} 对拍通过已入队（待处理），主备绑定已随单冻结`;
        this.turbineCode = "";
        this.primaryErr = "";
        this.backupErr = "";
      }
      await this.refreshAll();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private startEditBinding(b: Binding) {
    this.editingBindingId = b.id;
    this.bindTurbine = b.turbine_code;
    this.bindPrimary = b.primary_channel;
    this.bindBackup = b.backup_channel;
    this.bindThreshold = String(b.threshold_deg);
    this.error = "";
    this.notice = "";
  }

  private resetBindingForm() {
    this.editingBindingId = null;
    this.bindTurbine = "";
    this.bindPrimary = "";
    this.bindBackup = "";
    this.bindThreshold = "";
  }

  private async saveBinding() {
    this.error = "";
    this.notice = "";
    this.loading = true;
    try {
      const editing = this.editingBindingId !== null;
      const url = editing
        ? `/api/bindings/${this.editingBindingId}`
        : "/api/bindings";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.bindTurbine,
          primary_channel: this.bindPrimary,
          backup_channel: this.bindBackup,
          threshold_deg: Number(this.bindThreshold),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "保存失败";
        return;
      }
      this.notice = editing
        ? `机组 ${data.turbine_code} 绑定已更新（旧工单绑定快照不变）`
        : `机组 ${data.turbine_code} 主备绑定已登记`;
      this.resetBindingForm();
      await this.refreshBindings();
    } catch {
      this.error = "保存时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private statusTag(status: string) {
    if (status === "pending") return html`<span class="tag pending">待处理</span>`;
    if (status === "rejected") return html`<span class="tag bad">退回</span>`;
    return html`<span class="tag ok">已完成</span>`;
  }

  private verdictTag(row: OrderRow) {
    if (!row.verdict) return html`—`;
    const cls =
      row.verdict === "合格" ? "ok" : row.verdict === "双通道超差" ? "bad" : "bad";
    return html`<span class="tag ${cls}">${row.verdict}</span>`;
  }

  private fmtTime(value: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  private get availableBindings() {
    return this.bindings.filter((b) => !b.frozen);
  }

  private get rejectedOrders() {
    return this.orders.filter((o) => o.status === "rejected");
  }

  private renderLogin() {
    return html`
      <main>
        <h1>风机偏航对中台</h1>
        <p class="sub">
          主备两路编码器读数对拍一致才许入队；后台 worker 认领后按主路读数给出结论。
        </p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      </main>
    `;
  }

  private renderTopbar() {
    return html`
      <header class="topbar">
        <span class="brand">风机偏航对中台</span>
        <nav>
          <button
            class=${this.view === "logs" ? "active" : ""}
            @click=${() => this.switchView("logs")}
          >
            对中记录
          </button>
          <button
            class=${this.view === "station" ? "active" : ""}
            @click=${() => this.switchView("station")}
          >
            主备编码器双通道对拍入队台
          </button>
        </nav>
        <span class="who">
          ${this.session?.username}
          (${this.isWriter ? "技师·可提交" : "观察员·只读"})
          <button class="secondary" @click=${this.logout}>退出</button>
        </span>
      </header>
    `;
  }

  private renderSubmitSection() {
    if (!this.isWriter) return null;
    const available = this.availableBindings
      .map((b) => `${b.turbine_code}（门槛 ${b.threshold_deg}°）`)
      .join("、");
    return html`
      <section>
        <h2>提交双通道偏航工单</h2>
        <p class="hint">
          一次提交主备两路读数，差值绝对值超门槛将整单退回（双通道超差）；
          入队成功即随单冻结绑定。
          ${available ? html`当前可入队绑定：${available}` : html`暂无可入队绑定，请先到入队台专页登记。`}
        </p>
        <div class="form-grid">
          <div>
            <label>机组编号</label>
            <input
              list="binding-codes"
              placeholder="例如 W05"
              .value=${this.turbineCode}
              @input=${(e: Event) =>
                (this.turbineCode = (e.target as HTMLInputElement).value)}
            />
            <datalist id="binding-codes">
              ${this.bindings.map(
                (b) => html`<option value=${b.turbine_code}></option>`
              )}
            </datalist>
          </div>
          <div>
            <label>主路偏航误差（度，可正可负）</label>
            <input
              type="number"
              step="0.1"
              .value=${this.primaryErr}
              @input=${(e: Event) =>
                (this.primaryErr = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label>备路偏航误差（度，可正可负）</label>
            <input
              type="number"
              step="0.1"
              .value=${this.backupErr}
              @input=${(e: Event) =>
                (this.backupErr = (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <button ?disabled=${this.loading} @click=${this.submitOrder}>
          提交（双通道对拍入队）
        </button>
        ${this.error ? html`<p class="err">${this.error}</p>` : null}
        ${this.notice ? html`<p class="notice">${this.notice}</p>` : null}
      </section>
    `;
  }

  private renderOrdersTable() {
    return html`
      <section>
        <div class="row-actions" style="justify-content:space-between;">
          <h2 style="margin:0;">对中记录</h2>
          <button
            class="secondary"
            ?disabled=${this.loading}
            @click=${this.refreshAll}
          >
            刷新列表
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>机组</th>
                <th>主路编号</th>
                <th>备路编号</th>
                <th>主路误差°</th>
                <th>备路误差°</th>
                <th>差值°</th>
                <th>门槛°</th>
                <th>状态</th>
                <th>结论</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              ${this.orders.map(
                (row) => html`
                  <tr>
                    <td>${row.id}</td>
                    <td>${row.turbine_code}</td>
                    <td>${row.primary_channel}</td>
                    <td>${row.backup_channel}</td>
                    <td>${row.primary_err_deg}</td>
                    <td>${row.backup_err_deg}</td>
                    <td>${row.diff_deg}</td>
                    <td>${row.threshold_deg}</td>
                    <td>${this.statusTag(row.status)}</td>
                    <td>${this.verdictTag(row)}</td>
                    <td>${row.reason ?? "—"}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  private renderLogsView() {
    return html`
      <main>
        ${this.renderSubmitSection()} ${this.renderOrdersTable()}
      </main>
    `;
  }

  private renderBindingForm() {
    if (!this.isWriter) {
      return html`<p class="hint">观察员只读：可查看绑定与差值，不能登记/修改绑定，也不能提交工单。</p>`;
    }
    const editing = this.editingBindingId !== null;
    return html`
      <div class="form-grid">
        <div>
          <label>机组编号</label>
          <input
            placeholder="例如 一号机"
            ?disabled=${editing}
            .value=${this.bindTurbine}
            @input=${(e: Event) =>
              (this.bindTurbine = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label>主路编码器编号</label>
          <input
            placeholder="例如 ENC-01-P"
            .value=${this.bindPrimary}
            @input=${(e: Event) =>
              (this.bindPrimary = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label>备路编码器编号</label>
          <input
            placeholder="例如 ENC-01-B"
            .value=${this.bindBackup}
            @input=${(e: Event) =>
              (this.bindBackup = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label>差值门槛（度）</label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="例如 1.0"
            .value=${this.bindThreshold}
            @input=${(e: Event) =>
              (this.bindThreshold = (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="row-actions">
        <button ?disabled=${this.loading} @click=${this.saveBinding}>
          ${editing ? "保存修改" : "登记绑定"}
        </button>
        ${editing
          ? html`<button
              class="secondary"
              ?disabled=${this.loading}
              @click=${this.resetBindingForm}
            >
              取消
            </button>`
          : null}
      </div>
      ${this.error ? html`<p class="err">${this.error}</p>` : null}
      ${this.notice ? html`<p class="notice">${this.notice}</p>` : null}
    `;
  }

  private renderBindingsTable() {
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>机组</th>
              <th>主路编号</th>
              <th>备路编号</th>
              <th>差值门槛°</th>
              <th>绑定状态</th>
              <th>冻结工单</th>
              <th>登记人</th>
              <th>更新时间</th>
              ${this.isWriter ? html`<th>操作</th>` : null}
            </tr>
          </thead>
          <tbody>
            ${this.bindings.map(
              (b) => html`
                <tr>
                  <td>${b.turbine_code}</td>
                  <td>${b.primary_channel}</td>
                  <td>${b.backup_channel}</td>
                  <td>${b.threshold_deg}</td>
                  <td>
                    ${b.frozen
                      ? html`<span class="tag bad">已冻结（随单）</span>`
                      : html`<span class="tag ok">可入队</span>`}
                  </td>
                  <td>${b.frozen_by_order_id ?? "—"}</td>
                  <td>${b.created_by}</td>
                  <td>${this.fmtTime(b.updated_at)}</td>
                  ${this.isWriter
                    ? html`<td>
                        <button
                          class="secondary"
                          ?disabled=${this.loading}
                          @click=${() => this.startEditBinding(b)}
                        >
                          编辑
                        </button>
                      </td>`
                    : null}
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderRejectedOverview() {
    const rows = this.rejectedOrders;
    return html`
      <section>
        <h2>拒收样例总览</h2>
        ${rows.length === 0
          ? html`<p class="hint">暂无拒收样例。</p>`
          : html`
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>机组</th>
                      <th>主路误差°</th>
                      <th>备路误差°</th>
                      <th>差值°</th>
                      <th>门槛°（快照）</th>
                      <th>结论</th>
                      <th>说明</th>
                      <th>提交人</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (row) => html`
                        <tr>
                          <td>${row.id}</td>
                          <td>${row.turbine_code}</td>
                          <td>${row.primary_err_deg}</td>
                          <td>${row.backup_err_deg}</td>
                          <td>${row.diff_deg}</td>
                          <td>${row.threshold_deg}</td>
                          <td><span class="tag bad">${row.verdict}</span></td>
                          <td>${row.reason ?? "—"}</td>
                          <td>${row.created_by}</td>
                          <td>${this.fmtTime(row.created_at)}</td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              </div>
            `}
      </section>
    `;
  }

  private renderStationView() {
    return html`
      <main>
        <section>
          <h2>绑定登记（主路 / 备路 / 差值门槛）</h2>
          <p class="hint">
            登记机组的主备编码器编号与差值门槛；主备绑定关系随单冻结，
            事后改登记表不影响旧工单快照。
          </p>
          ${this.renderBindingForm()}
        </section>
        <section>
          <h2>绑定登记表</h2>
          ${this.renderBindingsTable()}
        </section>
        ${this.renderRejectedOverview()}
      </main>
    `;
  }

  render() {
    if (!this.session) {
      return this.renderLogin();
    }
    return html`
      ${this.renderTopbar()}
      ${this.view === "logs" ? this.renderLogsView() : this.renderStationView()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
