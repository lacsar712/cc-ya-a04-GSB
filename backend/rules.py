"""偏航对中判定。

双通道：主/备两路编码器读数差值绝对值不超过登记门槛才允许入队；
入队后以两路均值按 ±1.5° 阈值写入「合格」或「偏航超差」。
"""

THRESHOLD_DEG = 1.5


def judge(yaw_err_deg: float) -> tuple[str, str]:
    if abs(yaw_err_deg) <= THRESHOLD_DEG:
        return "合格", f"偏航误差 {yaw_err_deg}° 在 ±{THRESHOLD_DEG}° 以内"
    return "偏航超差", f"偏航误差 {yaw_err_deg}° 超过 ±{THRESHOLD_DEG}°"


def cross_check(
    primary_err_deg: float,
    backup_err_deg: float,
    diff_threshold_deg: float,
) -> tuple[float, float, str | None]:
    """主备双通道对拍。

    返回 (两路均值, 差值绝对值, 拒收原因)；原因为 None 表示对拍一致、允许入队。
    """
    diff = abs(primary_err_deg - backup_err_deg)
    avg = round((primary_err_deg + backup_err_deg) / 2.0, 4)
    if diff > diff_threshold_deg:
        reason = (
            f"双通道超差：主路 {primary_err_deg}° 与备路 {backup_err_deg}° "
            f"差值 {diff}° 超过门槛 {diff_threshold_deg}°，整单退回"
        )
        return avg, round(diff, 4), reason
    return avg, round(diff, 4), None
