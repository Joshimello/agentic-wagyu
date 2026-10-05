/** Models sometimes encode abstention as a candidate name; keep those speakers unnamed. */
export function isUsableCandidateName(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const name = value.trim().replace(/[()（）\[\]【】\s]/g, '');
  if (/^(未具名|無明確姓名|无明确姓名)/.test(name)) return false;
  return !/^(unknown|unresolved|unidentified|unsure|n\/?a|none|null|unnamed|notprovided|notavailable|notdetermined|無|无|匿名|未知|不明|未知姓名|無法確定|无法确定|不確定|不确定|無法辨識|无法辨识|未確認|未确认|未識別|未识别|未命名|無明確姓名線索|无明确姓名线索)$/i.test(
    name,
  );
}
