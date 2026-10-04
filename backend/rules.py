"""偏航对中判定与主备双通道对拍规则。

- 入队前对拍：主备两路编码器读数差值绝对值超过登记门槛，整单退回（双通道超差）。
- 入队后判定：worker 以主路读数按 ±1.5° 阈值给出「合格」或「偏航超差」。
"""

THRESHOLD_DEG = 1.5

REJECT_VERDICT = "双通道超差"


def judge(primary_err_deg: float) -> tuple[str, str]:
    """worker 对主路读数给出对中结论。"""
    if abs(primary_err_deg) <= THRESHOLD_DEG:
        return "合格", f"主路偏航误差 {primary_err_deg}° 在 ±{THRESHOLD_DEG}° 以内"
    return "偏航超差", f"主路偏航误差 {primary_err_deg}° 超过 ±{THRESHOLD_DEG}°"


def channel_diff(primary_err_deg: float, backup_err_deg: float) -> float:
    """主备两路读数差值的绝对值，保留 6 位小数以消除浮点噪声。"""
    return round(abs(primary_err_deg - backup_err_deg), 6)


def cross_check(
    primary_err_deg: float,
    backup_err_deg: float,
    threshold_deg: float,
) -> tuple[bool, float, str]:
    """对拍：差值绝对值超门槛则整单退回，返回 (是否放行, 差值, 退回原因)。"""
    diff = channel_diff(primary_err_deg, backup_err_deg)
    if diff > threshold_deg:
        reason = (
            f"主备差值 {diff}° 超过门槛 {threshold_deg}°，"
            f"{REJECT_VERDICT}，整单退回"
        )
        return False, diff, reason
    return True, diff, ""
