import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type Binding = {
  id: number;
  turbine_code: string;
  primary_code: string;
  backup_code: string;
  diff_threshold_deg: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type LogRow = {
  id: number;
  binding_id: number | null;
  turbine_code: string;
  primary_code: string;
  backup_code: string;
  primary_err_deg: number;
  backup_err_deg: number;
  diff_deg: number;
  yaw_err_deg: number;
  diff_threshold_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type RejectedRow = {
  id: number;
  binding_id: number | null;
  turbine_code: string;
  primary_code: string;
  backup_code: string;
  primary_err_deg: number;
  backup_err_deg: number;
  diff_deg: number;
  diff_threshold_deg: number;
  reason: string;
  rejected_by: string;
  rejected_at: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type Tab = "queue" | "desk";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 1080px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid #334155;
      padding-bottom: 0.75rem;
    }
    .topbar h1 {
      margin: 0;
      font-size: 1.35rem;
      color: #38bdf8;
    }
    .nav {
      display: flex;
      gap: 0.5rem;
    }
    .nav a {
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      text-decoration: none;
      color: #cbd5e1;
      background: #1e293b;
      border: 1px solid #334155;
      font-size: 0.9rem;
    }
    .nav a.active {
      background: #0284c7;
      color: #fff;
      border-color: #0284c7;
      font-weight: 600;
    }
    .topbar .spacer {
      flex: 1;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input,
    select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 0.75rem;
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
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
      white-space: nowrap;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
      white-space: nowrap;
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
    .reject {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .ok-text {
      color: #86efac;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .readonly-note {
      background: #172554;
      color: #bfdbfe;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private tab: Tab = "queue";
  @state() private bindings: Binding[] = [];
  @state() private logs: LogRow[] = [];
  @state() private rejected: RejectedRow[] = [];

  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private error = "";
  @state() private loading = false;

  // 对拍入队表单
  @state() private selectedBindingId = "";
  @state() private primaryErr = "";
  @state() private backupErr = "";
  @state() private submitError = "";
  @state() private submitOk = "";

  // 绑定登记表单
  @state() private bindTurbine = "";
  @state() private bindPrimary = "";
  @state() private bindBackup = "";
  @state() private bindThreshold = "";
  @state() private editingBindingId: number | null = null;
  @state() private bindError = "";

  private _pollTimer?: number;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        this.tab = window.location.hash === "#/desk" ? "desk" : "queue";
        window.addEventListener("hashchange", this._onHashChange);
        void this.refreshAll();
        this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this._onHashChange);
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _onHashChange = () => {
    this.tab = window.location.hash === "#/desk" ? "desk" : "queue";
  };

  private goto(tab: Tab) {
    window.location.hash = tab === "desk" ? "#/desk" : "#/queue";
  }

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async apiGet(path: string) {
    const res = await fetch(path, { headers: this.authHeaders() });
    if (res.status === 401) {
      this.logout();
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  }

  private async refreshAll() {
    if (!this.session) return;
    const [bindings, logs, rejected] = await Promise.all([
      this.apiGet("/api/bindings"),
      this.apiGet("/api/logs"),
      this.apiGet("/api/rejected"),
    ]);
    if (bindings) this.bindings = bindings as Binding[];
    if (logs) this.logs = logs as LogRow[];
    if (rejected) this.rejected = rejected as RejectedRow[];
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
      this.tab = window.location.hash === "#/desk" ? "desk" : "queue";
      window.addEventListener("hashchange", this._onHashChange);
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
    window.removeEventListener("hashchange", this._onHashChange);
    this.session = null;
    this.bindings = [];
    this.logs = [];
    this.rejected = [];
    localStorage.removeItem("yaw_session");
  }

  private selectedBinding(): Binding | null {
    const id = Number(this.selectedBindingId);
    return this.bindings.find((b) => b.id === id) ?? null;
  }

  private liveDiff(): { ok: boolean; text: string } | null {
    const binding = this.selectedBinding();
    const p = Number(this.primaryErr);
    const b = Number(this.backupErr);
    if (!binding || this.primaryErr === "" || this.backupErr === "") return null;
    if (Number.isNaN(p) || Number.isNaN(b)) return null;
    const diff = Math.abs(p - b);
    if (diff > binding.diff_threshold_deg) {
      return {
        ok: false,
        text: `主备差值 ${diff}° 已超门槛 ${binding.diff_threshold_deg}°，提交将整单退回（双通道超差）`,
      };
    }
    return {
      ok: true,
      text: `主备差值 ${diff}° 在门槛 ${binding.diff_threshold_deg}° 以内，对拍一致可入队`,
    };
  }

  private async submitLog() {
    this.submitError = "";
    this.submitOk = "";
    const binding = this.selectedBinding();
    if (!binding) {
      this.submitError = "请先在双通道对拍入队台登记并选择主备绑定";
      return;
    }
    if (this.primaryErr === "" || this.backupErr === "") {
      this.submitError = "主路与备路读数都必须填写";
      return;
    }
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          binding_id: binding.id,
          primary_err_deg: Number(this.primaryErr),
          backup_err_deg: Number(this.backupErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.submitError = data.detail || "提交失败";
        if (res.status === 400) void this.refreshAll();
        return;
      }
      this.submitOk = `已入队（单号 ${data.id}）：主备差值 ${data.diff_deg}°，等待 worker 对中判定`;
      this.primaryErr = "";
      this.backupErr = "";
      await this.refreshAll();
    } catch {
      this.submitError = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private resetBindForm() {
    this.editingBindingId = null;
    this.bindTurbine = "";
    this.bindPrimary = "";
    this.bindBackup = "";
    this.bindThreshold = "";
    this.bindError = "";
  }

  private startEdit(b: Binding) {
    this.editingBindingId = b.id;
    this.bindTurbine = b.turbine_code;
    this.bindPrimary = b.primary_code;
    this.bindBackup = b.backup_code;
    this.bindThreshold = String(b.diff_threshold_deg);
    this.bindError = "";
  }

  private async submitBinding() {
    this.bindError = "";
    const payload = {
      turbine_code: this.bindTurbine.trim(),
      primary_code: this.bindPrimary.trim(),
      backup_code: this.bindBackup.trim(),
      diff_threshold_deg: Number(this.bindThreshold),
    };
    if (
      !payload.turbine_code ||
      !payload.primary_code ||
      !payload.backup_code ||
      this.bindThreshold === "" ||
      Number.isNaN(payload.diff_threshold_deg)
    ) {
      this.bindError = "机组编号、主路编号、备路编号、差值门槛均需填写";
      return;
    }
    this.loading = true;
    try {
      const isEdit = this.editingBindingId !== null;
      const res = await fetch(
        isEdit ? `/api/bindings/${this.editingBindingId}` : "/api/bindings",
        {
          method: isEdit ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        this.bindError = data.detail || "登记失败";
        return;
      }
      this.resetBindForm();
      await this.refreshAll();
    } catch {
      this.bindError = "登记时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private fmtTime(value: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? value
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">
          主备两路编码器读数对拍一致才许入队；后台 worker 认领后给出合格或偏航超差结论。
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
      `;
    }

    return html`
      <div class="topbar">
        <h1>风机偏航对中台</h1>
        <nav class="nav">
          <a
            href="#/queue"
            class=${this.tab === "queue" ? "active" : ""}
            @click=${() => this.goto("queue")}
            >对拍入队</a
          >
          <a
            href="#/desk"
            class=${this.tab === "desk" ? "active" : ""}
            @click=${() => this.goto("desk")}
            >主备编码器双通道对拍入队台</a
          >
        </nav>
        <span class="spacer"></span>
        <span class="who">
          ${this.session.username}（${this.isWriter ? "现场技师·可登记可报数" : "观察员·只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>

      ${this.tab === "queue" ? this.renderQueue() : this.renderDesk()}
    `;
  }

  private renderQueue() {
    const diff = this.liveDiff();
    return html`
      ${this.isWriter
        ? html`
            <section>
              <h2>主备双通道对拍提交</h2>
              <p class="hint" style="margin-top:0">
                一次提交主、备两路编码器读数；|主−备| 超过绑定登记门槛则整单退回（双通道超差），不入队。
              </p>
              <label>主备绑定（机组 / 主路 → 备路 / 差值门槛）</label>
              <select
                .value=${this.selectedBindingId}
                @change=${(e: Event) =>
                  (this.selectedBindingId = (e.target as HTMLSelectElement).value)}
              >
                <option value="">请选择已登记绑定…</option>
                ${this.bindings.map(
                  (b) => html`
                    <option value=${b.id}>
                      ${b.turbine_code} / ${b.primary_code} → ${b.backup_code} /
                      门槛 ${b.diff_threshold_deg}°
                    </option>
                  `
                )}
              </select>
              ${this.bindings.length === 0
                ? html`<p class="err">尚无绑定，请先到「主备编码器双通道对拍入队台」登记。</p>`
                : null}
              <div class="grid2">
                <div>
                  <label>主路编码器读数（度）</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例如 0.8"
                    .value=${this.primaryErr}
                    @input=${(e: Event) =>
                      (this.primaryErr = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>备路编码器读数（度）</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例如 0.9"
                    .value=${this.backupErr}
                    @input=${(e: Event) =>
                      (this.backupErr = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              ${diff
                ? html`<p class=${diff.ok ? "ok-text" : "err"}>${diff.text}</p>`
                : null}
              <button
                ?disabled=${this.loading || this.bindings.length === 0}
                @click=${this.submitLog}
              >
                对拍提交（一致才入队）
              </button>
              ${this.submitError
                ? html`<p class="err">${this.submitError}</p>`
                : null}
              ${this.submitOk
                ? html`<p class="ok-text">${this.submitOk}</p>`
                : null}
            </section>
          `
        : html`
            <section>
              <p class="readonly-note" style="margin:0">
                观察员只读：可查看主备绑定、两路读数与差值，但不能改绑定，也不能报数。
              </p>
            </section>
          `}

      <section>
        <h2>对拍入队记录</h2>
        <table>
          <thead>
            <tr>
              <th>单号</th>
              <th>机组</th>
              <th>主路编号 / 读数°</th>
              <th>备路编号 / 读数°</th>
              <th>差值°</th>
              <th>入队均值°</th>
              <th>冻结门槛°</th>
              <th>状态</th>
              <th>结论</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td>${row.primary_code}<br />${row.primary_err_deg}</td>
                  <td>${row.backup_code}<br />${row.backup_err_deg}</td>
                  <td>${row.diff_deg}</td>
                  <td>${row.yaw_err_deg}</td>
                  <td>${row.diff_threshold_deg}</td>
                  <td>
                    <span
                      class="tag ${row.status === "pending" ? "pending" : "ok"}"
                    >
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}"
                          >${row.verdict}</span
                        >`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderDesk() {
    return html`
      <section>
        <h2>
          ${this.editingBindingId !== null
            ? `修改绑定登记 #${this.editingBindingId}`
            : "登记主备编码器绑定"}
        </h2>
        ${this.isWriter
          ? html`
              <p class="hint" style="margin-top:0">
                绑定快照随单冻结：此处修改只影响新单，已入队/已拒收单据仍保留当时的编号与门槛。
              </p>
              <div class="grid2">
                <div>
                  <label>机组编号</label>
                  <input
                    placeholder="例如 W01 / 一号机"
                    .value=${this.bindTurbine}
                    @input=${(e: Event) =>
                      (this.bindTurbine = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>主备差值门槛 |主−备|（度）</label>
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
                <div>
                  <label>主路编码器编号</label>
                  <input
                    placeholder="例如 ENC-W01-A"
                    .value=${this.bindPrimary}
                    @input=${(e: Event) =>
                      (this.bindPrimary = (e.target as HTMLInputElement).value)}
                  />
                </div>
                <div>
                  <label>备路编码器编号</label>
                  <input
                    placeholder="例如 ENC-W01-B"
                    .value=${this.bindBackup}
                    @input=${(e: Event) =>
                      (this.bindBackup = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class="row-actions">
                <button
                  ?disabled=${this.loading}
                  @click=${this.submitBinding}
                >
                  ${this.editingBindingId !== null ? "保存修改" : "登记绑定"}
                </button>
                ${this.editingBindingId !== null
                  ? html`<button class="secondary" @click=${this.resetBindForm}>
                      取消修改
                    </button>`
                  : null}
              </div>
              ${this.bindError ? html`<p class="err">${this.bindError}</p>` : null}
            `
          : html`<p class="readonly-note" style="margin:0">
              观察员只读：以下绑定登记与拒收样例均可查看，但不能登记或修改绑定。
            </p>`}
      </section>

      <section>
        <h2>主备绑定登记总览</h2>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>主路编码器</th>
              <th>备路编码器</th>
              <th>差值门槛°</th>
              <th>登记人</th>
              <th>更新时间</th>
              ${this.isWriter ? html`<th>操作</th>` : null}
            </tr>
          </thead>
          <tbody>
            ${this.bindings.map(
              (b) => html`
                <tr>
                  <td>${b.id}</td>
                  <td>${b.turbine_code}</td>
                  <td>${b.primary_code}</td>
                  <td>${b.backup_code}</td>
                  <td>${b.diff_threshold_deg}</td>
                  <td>${b.created_by}</td>
                  <td>${this.fmtTime(b.updated_at)}</td>
                  ${this.isWriter
                    ? html`<td>
                        <button class="secondary" @click=${() => this.startEdit(b)}>
                          修改
                        </button>
                      </td>`
                    : null}
                </tr>
              `
            )}
            ${this.bindings.length === 0
              ? html`<tr>
                  <td colspan=${this.isWriter ? "8" : "7"} class="hint">
                    暂无绑定登记。
                  </td>
                </tr>`
              : null}
          </tbody>
        </table>
      </section>

      <section>
        <h2>拒收样例总览（双通道超差整单退回）</h2>
        <table>
          <thead>
            <tr>
              <th>拒收号</th>
              <th>拒收时间</th>
              <th>机组</th>
              <th>主路编号 / 读数°</th>
              <th>备路编号 / 读数°</th>
              <th>差值°</th>
              <th>当时门槛°</th>
              <th>拒收原因</th>
              <th>操作人</th>
            </tr>
          </thead>
          <tbody>
            ${this.rejected.map(
              (r) => html`
                <tr>
                  <td>${r.id}</td>
                  <td>${this.fmtTime(r.rejected_at)}</td>
                  <td>${r.turbine_code}</td>
                  <td>${r.primary_code}<br />${r.primary_err_deg}</td>
                  <td>${r.backup_code}<br />${r.backup_err_deg}</td>
                  <td><span class="tag reject">${r.diff_deg}</span></td>
                  <td>${r.diff_threshold_deg}</td>
                  <td>${r.reason}</td>
                  <td>${r.rejected_by}</td>
                </tr>
              `
            )}
            ${this.rejected.length === 0
              ? html`<tr>
                  <td colspan="9" class="hint">暂无拒收样例。</td>
                </tr>`
              : null}
          </tbody>
        </table>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
