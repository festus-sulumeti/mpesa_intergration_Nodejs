export function darajaTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value ?? "";
    return value === "24" ? "00" : value;
  };
  return `${pick("year")}${pick("month")}${pick("day")}${pick("hour")}${pick("minute")}${pick("second")}`;
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function nairobiDay(date: Date): string {
  return darajaTimestamp(date).slice(0, 8);
}
