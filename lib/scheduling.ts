export type SendingWindow = {
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  weekdays: number[];
};

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return { weekday, minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")) };
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function nextAllowedSendAt(candidate: Date, window: SendingWindow) {
  const start = timeToMinutes(window.allowedStartTime);
  const end = timeToMinutes(window.allowedEndTime);
  const cursor = new Date(Math.ceil(candidate.valueOf() / 60_000) * 60_000);

  // Uma campanha sempre possui ao menos um dia válido; oito dias cobrem a próxima janela.
  for (let minute = 0; minute <= 8 * 24 * 60; minute += 1) {
    const current = new Date(cursor.valueOf() + minute * 60_000);
    const local = localParts(current, window.timezone);
    if (window.weekdays.includes(local.weekday) && local.minuteOfDay >= start && local.minuteOfDay < end) {
      return current;
    }
  }
  throw new Error("Não foi possível encontrar uma janela de envio válida.");
}
