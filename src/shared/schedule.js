(function (root) {
  'use strict';

  const DarkExt = (root.DarkExt = root.DarkExt || {});

  function parseTimeToMinutes(timeStr) {
    if (typeof timeStr !== 'string') {
      return null;
    }
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return null;
    }
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  function resolveMinutes(input) {
    if (input instanceof Date) {
      if (Number.isNaN(input.getTime())) {
        return null;
      }
      return input.getHours() * 60 + input.getMinutes();
    }
    if (typeof input === 'string') {
      return parseTimeToMinutes(input);
    }
    if (typeof input === 'number' && Number.isFinite(input) && input >= 0 && input < 1440) {
      return Math.floor(input);
    }
    return null;
  }

  function isWithinTimeWindow(nowMinutes, startMinutes, endMinutes) {
    const now = resolveMinutes(nowMinutes);
    const start = resolveMinutes(startMinutes);
    const end = resolveMinutes(endMinutes);

    if (now === null || start === null || end === null) {
      return false;
    }

    if (start === end) {
      return true;
    }

    if (start < end) {
      return now >= start && now < end;
    }

    // Overnight window wrapping past midnight (e.g. 20:00 -> 07:00)
    return now >= start || now < end;
  }

  function detectSystemDark() {
    if (typeof root.matchMedia === 'function') {
      try {
        return Boolean(root.matchMedia('(prefers-color-scheme: dark)').matches);
      } catch {
        return false;
      }
    }
    return false;
  }

  function isScheduleActive(schedule, options, maybeNow) {
    if (!schedule || typeof schedule !== 'object') {
      return true;
    }

    const mode = schedule.mode || 'off';
    if (mode === 'off') {
      return true;
    }

    let now = new Date();
    let systemPrefersDark;

    if (options instanceof Date) {
      now = options;
    } else if (typeof options === 'boolean') {
      systemPrefersDark = options;
      if (maybeNow instanceof Date) {
        now = maybeNow;
      }
    } else if (options && typeof options === 'object') {
      if (options.now instanceof Date) {
        now = options.now;
      }
      if (typeof options.systemPrefersDark === 'boolean') {
        systemPrefersDark = options.systemPrefersDark;
      }
    }

    if (mode === 'system') {
      if (typeof systemPrefersDark === 'boolean') {
        return systemPrefersDark;
      }
      return detectSystemDark();
    }

    if (mode === 'time') {
      const startMin = parseTimeToMinutes(schedule.startTime || '20:00');
      const endMin = parseTimeToMinutes(schedule.endTime || '07:00');
      const nowMin = now.getHours() * 60 + now.getMinutes();
      return isWithinTimeWindow(nowMin, startMin, endMin);
    }

    return true;
  }

  const Schedule = Object.freeze({
    parseTimeToMinutes,
    isWithinTimeWindow,
    isScheduleActive
  });

  DarkExt.Schedule = Schedule;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Schedule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
