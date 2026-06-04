import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StatusBar, TouchableOpacity, ActivityIndicator, Alert,
  ScrollView, Modal, FlatList, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getMe } from '../services/profile';
import { getReportSettings, patchReportSettings, type ReportSettings } from '../services/report';

// ─── Day strip ────────────────────────────────────────────────────────────────
// Display order: Sun-first (JS convention). Each entry carries the ISO weekday
// value the API expects (1=Mon … 7=Sun).
const DAYS = [
  { label: 'Sun', iso: 7 },
  { label: 'Mon', iso: 1 },
  { label: 'Tue', iso: 2 },
  { label: 'Wed', iso: 3 },
  { label: 'Thu', iso: 4 },
  { label: 'Fri', iso: 5 },
  { label: 'Sat', iso: 6 },
];

// ─── Timezone list ────────────────────────────────────────────────────────────
type TZOption = { value: string; label: string; offset: string };

const TIMEZONES: TZOption[] = [
  { value: 'Pacific/Midway',                 label: 'Midway Island',                  offset: 'UTC−11'  },
  { value: 'Pacific/Honolulu',               label: 'Hawaii',                         offset: 'UTC−10'  },
  { value: 'America/Anchorage',              label: 'Alaska',                         offset: 'UTC−9'   },
  { value: 'America/Los_Angeles',            label: 'Pacific Time (US & Canada)',     offset: 'UTC−8'   },
  { value: 'America/Denver',                 label: 'Mountain Time (US & Canada)',    offset: 'UTC−7'   },
  { value: 'America/Phoenix',                label: 'Arizona',                        offset: 'UTC−7'   },
  { value: 'America/Chicago',                label: 'Central Time (US & Canada)',     offset: 'UTC−6'   },
  { value: 'America/Mexico_City',            label: 'Mexico City',                    offset: 'UTC−6'   },
  { value: 'America/New_York',               label: 'Eastern Time (US & Canada)',     offset: 'UTC−5'   },
  { value: 'America/Bogota',                 label: 'Bogota, Lima, Quito',            offset: 'UTC−5'   },
  { value: 'America/Caracas',                label: 'Caracas',                        offset: 'UTC−4'   },
  { value: 'America/Halifax',                label: 'Atlantic Time (Canada)',         offset: 'UTC−4'   },
  { value: 'America/Sao_Paulo',              label: 'Brasilia',                       offset: 'UTC−3'   },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires',                   offset: 'UTC−3'   },
  { value: 'Atlantic/South_Georgia',         label: 'Mid-Atlantic',                   offset: 'UTC−2'   },
  { value: 'Atlantic/Azores',                label: 'Azores',                         offset: 'UTC−1'   },
  { value: 'Europe/London',                  label: 'London, Dublin, Lisbon',         offset: 'UTC+0'   },
  { value: 'Africa/Casablanca',              label: 'Casablanca',                     offset: 'UTC+0'   },
  { value: 'UTC',                            label: 'UTC',                            offset: 'UTC+0'   },
  { value: 'Europe/Paris',                   label: 'Paris, Madrid, Brussels',        offset: 'UTC+1'   },
  { value: 'Europe/Berlin',                  label: 'Berlin, Amsterdam, Rome',        offset: 'UTC+1'   },
  { value: 'Africa/Lagos',                   label: 'West Central Africa',            offset: 'UTC+1'   },
  { value: 'Europe/Athens',                  label: 'Athens, Bucharest',              offset: 'UTC+2'   },
  { value: 'Africa/Cairo',                   label: 'Cairo',                          offset: 'UTC+2'   },
  { value: 'Asia/Beirut',                    label: 'Beirut',                         offset: 'UTC+2'   },
  { value: 'Asia/Jerusalem',                 label: 'Jerusalem',                      offset: 'UTC+2'   },
  { value: 'Africa/Johannesburg',            label: 'Pretoria, Harare',               offset: 'UTC+2'   },
  { value: 'Europe/Moscow',                  label: 'Moscow, St. Petersburg',         offset: 'UTC+3'   },
  { value: 'Asia/Riyadh',                    label: 'Riyadh, Baghdad, Kuwait',        offset: 'UTC+3'   },
  { value: 'Africa/Nairobi',                 label: 'Nairobi',                        offset: 'UTC+3'   },
  { value: 'Asia/Tehran',                    label: 'Tehran',                         offset: 'UTC+3:30' },
  { value: 'Asia/Dubai',                     label: 'Abu Dhabi, Dubai, Muscat',       offset: 'UTC+4'   },
  { value: 'Asia/Baku',                      label: 'Baku, Tbilisi, Yerevan',         offset: 'UTC+4'   },
  { value: 'Asia/Kabul',                     label: 'Kabul',                          offset: 'UTC+4:30' },
  { value: 'Asia/Karachi',                   label: 'Islamabad, Karachi',             offset: 'UTC+5'   },
  { value: 'Asia/Tashkent',                  label: 'Tashkent',                       offset: 'UTC+5'   },
  { value: 'Asia/Kolkata',                   label: 'Chennai, Mumbai, New Delhi',     offset: 'UTC+5:30' },
  { value: 'Asia/Kathmandu',                 label: 'Kathmandu',                      offset: 'UTC+5:45' },
  { value: 'Asia/Almaty',                    label: 'Almaty, Novosibirsk',            offset: 'UTC+6'   },
  { value: 'Asia/Dhaka',                     label: 'Dhaka',                          offset: 'UTC+6'   },
  { value: 'Asia/Rangoon',                   label: 'Yangon (Rangoon)',               offset: 'UTC+6:30' },
  { value: 'Asia/Bangkok',                   label: 'Bangkok, Hanoi, Jakarta',        offset: 'UTC+7'   },
  { value: 'Asia/Krasnoyarsk',               label: 'Krasnoyarsk',                    offset: 'UTC+7'   },
  { value: 'Asia/Shanghai',                  label: 'Beijing, Shanghai, Hong Kong',   offset: 'UTC+8'   },
  { value: 'Asia/Singapore',                 label: 'Singapore, Kuala Lumpur',        offset: 'UTC+8'   },
  { value: 'Australia/Perth',                label: 'Perth',                          offset: 'UTC+8'   },
  { value: 'Asia/Tokyo',                     label: 'Tokyo, Osaka',                   offset: 'UTC+9'   },
  { value: 'Asia/Seoul',                     label: 'Seoul',                          offset: 'UTC+9'   },
  { value: 'Australia/Adelaide',             label: 'Adelaide',                       offset: 'UTC+9:30' },
  { value: 'Australia/Darwin',               label: 'Darwin',                         offset: 'UTC+9:30' },
  { value: 'Australia/Sydney',               label: 'Sydney, Melbourne',              offset: 'UTC+10'  },
  { value: 'Australia/Brisbane',             label: 'Brisbane',                       offset: 'UTC+10'  },
  { value: 'Pacific/Auckland',               label: 'Auckland, Wellington',           offset: 'UTC+12'  },
  { value: 'Pacific/Fiji',                   label: 'Fiji',                           offset: 'UTC+12'  },
];

function tzLabel(iana: string) {
  return TIMEZONES.find((t) => t.value === iana)?.label ?? iana;
}
function tzOffset(iana: string) {
  return TIMEZONES.find((t) => t.value === iana)?.offset ?? '';
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function to24h(h: number, pm: boolean): number {
  if (pm && h !== 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

function from24h(h24: number): { hour: number; isPM: boolean } {
  if (h24 === 0) return { hour: 12, isPM: false };
  if (h24 < 12) return { hour: h24, isPM: false };
  if (h24 === 12) return { hour: 12, isPM: true };
  return { hour: h24 - 12, isPM: true };
}

function buildTimeString(h: number, m: number, pm: boolean): string {
  const h24 = to24h(h, pm);
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// FastAPI returns detail as a string OR an array of {loc, msg, type} objects.
function apiErrorMessage(err: any): string {
  const detail = err?.response?.data?.detail;
  if (!detail) return 'Please try again.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d.msg ?? String(d)).join('\n');
  return 'Please try again.';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportEmailScreen() {
  const router = useRouter();
  const storedEmail = useAuthStore((s) => s.email);
  const [email, setEmail] = useState(storedEmail ?? '');
  const [emailLoading, setEmailLoading] = useState(!storedEmail);

  const [reportDay, setReportDay] = useState(7);        // ISO, default Sun
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [isPM, setIsPM] = useState(false);
  const [timezone, setTimezone] = useState('UTC');

  const [savingDay, setSavingDay] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [tzModalOpen, setTzModalOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  // True once the admin has sent at least one PATCH (so we stop piggybacking device TZ)
  const hasAutoSentTzRef = useRef(false);
  const saveTimeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applySettings(s: ReportSettings) {
    setReportDay(s.report_day);
    const [h24Str, mStr] = s.report_time.split(':');
    const { hour: h, isPM: pm } = from24h(parseInt(h24Str, 10));
    setHour(h);
    setMinute(parseInt(mStr, 10));
    setIsPM(pm);
    setTimezone(s.report_timezone);
  }

  // Wrap every PATCH: on first call, piggyback device timezone if server is still UTC.
  // Only auto-send the device TZ if it's in our curated list — avoids 422 from
  // deprecated IANA aliases or platform-specific names zoneinfo doesn't recognise.
  const doPatch = useCallback(
    async (fields: Partial<Pick<ReportSettings, 'report_day' | 'report_time' | 'report_timezone'>>) => {
      const payload = { ...fields };
      if (!hasAutoSentTzRef.current) {
        hasAutoSentTzRef.current = true;
        try {
          const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const isKnown = TIMEZONES.some((t) => t.value === deviceTz);
          if (!payload.report_timezone && isKnown && deviceTz !== 'UTC') {
            payload.report_timezone = deviceTz;
          }
        } catch {
          // Intl unavailable or timezone undetectable — skip auto-send
        }
      }
      console.log('[report-settings] PATCH payload:', JSON.stringify(payload));
      return patchReportSettings(payload);
    },
    [],
  );

  useEffect(() => {
    if (!storedEmail) {
      getMe()
        .then((me) => setEmail(me.user.email))
        .catch(() => {})
        .finally(() => setEmailLoading(false));
    }

    getReportSettings()
      .then((s) => {
        applySettings(s);
        // If admin already configured a non-UTC timezone, no need to auto-send
        if (s.report_timezone !== 'UTC') {
          hasAutoSentTzRef.current = true;
        }
      })
      .catch(() => {})
      .finally(() => setSettingsLoading(false));

    return () => {
      if (saveTimeRef.current) clearTimeout(saveTimeRef.current);
    };
  }, []);

  // ── Day ───────────────────────────────────────────────────────────────────
  async function handleSelectDay(isoDay: number) {
    if (savingDay || isoDay === reportDay) return;
    const prev = reportDay;
    setReportDay(isoDay);
    setSavingDay(true);
    try {
      const updated = await doPatch({ report_day: isoDay });
      applySettings(updated);
    } catch (err: any) {
      setReportDay(prev);
      console.error('[report-settings] PATCH day failed:', err?.response?.data);
      Alert.alert('Update failed', apiErrorMessage(err));
    } finally {
      setSavingDay(false);
    }
  }

  // ── Time ──────────────────────────────────────────────────────────────────
  function scheduleTimeSave(h: number, m: number, pm: boolean) {
    if (saveTimeRef.current) clearTimeout(saveTimeRef.current);
    saveTimeRef.current = setTimeout(async () => {
      setSavingTime(true);
      try {
        const updated = await doPatch({ report_time: buildTimeString(h, m, pm) });
        applySettings(updated);
      } catch (err: any) {
        console.error('[report-settings] PATCH time failed:', err?.response?.data);
        Alert.alert('Update failed', apiErrorMessage(err));
      } finally {
        setSavingTime(false);
      }
    }, 1000);
  }

  function changeHour(delta: number) {
    const next = ((hour - 1 + delta + 12) % 12) + 1;
    setHour(next);
    scheduleTimeSave(next, minute, isPM);
  }

  function changeMinute(delta: number) {
    const next = (minute + delta * 5 + 60) % 60;
    setMinute(next);
    scheduleTimeSave(hour, next, isPM);
  }

  function handleToggleAmPm(pm: boolean) {
    setIsPM(pm);
    scheduleTimeSave(hour, minute, pm);
  }

  // ── Timezone ──────────────────────────────────────────────────────────────
  async function handleSelectTimezone(tz: string) {
    setTzModalOpen(false);
    setTzSearch('');
    if (tz === timezone) return;
    const prev = timezone;
    setTimezone(tz);
    setSavingTz(true);
    try {
      const updated = await doPatch({ report_timezone: tz });
      applySettings(updated);
    } catch (err: any) {
      setTimezone(prev);
      console.error('[report-settings] PATCH timezone failed:', err?.response?.data);
      Alert.alert('Update failed', apiErrorMessage(err));
    } finally {
      setSavingTz(false);
    }
  }

  const filteredTz = tzSearch.trim()
    ? TIMEZONES.filter(
        (t) =>
          t.label.toLowerCase().includes(tzSearch.toLowerCase()) ||
          t.value.toLowerCase().includes(tzSearch.toLowerCase()) ||
          t.offset.toLowerCase().includes(tzSearch.toLowerCase()),
      )
    : TIMEZONES;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Report settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16 }}>

        {/* Email card */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden">
          <View className="px-5 pt-5 pb-4">
            <View className="flex-row items-center gap-3 mb-4">
              <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="mail-outline" size={20} color="#1D9E75" />
              </View>
              <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                Weekly report destination
              </Text>
            </View>
            {emailLoading ? (
              <ActivityIndicator size="small" color="#1D9E75" style={{ alignSelf: 'flex-start' }} />
            ) : (
              <Text className="text-[17px] font-semibold text-text-primary">{email || '—'}</Text>
            )}
          </View>
          <View className="h-px bg-border" />
          <View className="px-5 py-4 flex-row gap-2.5 items-start">
            <Ionicons name="information-circle-outline" size={16} color="#6B9E8A" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-text-muted leading-5">
              Your household's weekly shopping report is automatically sent to this address.
              This is your account's login email.
            </Text>
          </View>
        </View>

        {/* Report day */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden">
          <View className="px-5 pt-5 pb-4">
            <View className="flex-row items-center gap-3 mb-4">
              <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="calendar-outline" size={20} color="#1D9E75" />
              </View>
              <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider flex-1">
                Report day
              </Text>
              {(savingDay || settingsLoading) && <ActivityIndicator size="small" color="#1D9E75" />}
            </View>
            <View className="flex-row gap-1.5">
              {DAYS.map(({ label, iso }) => {
                const selected = reportDay === iso;
                return (
                  <TouchableOpacity
                    key={iso}
                    onPress={() => handleSelectDay(iso)}
                    disabled={savingDay || settingsLoading}
                    activeOpacity={0.75}
                    style={{ flex: 1 }}
                    className={`py-2.5 rounded-xl items-center ${selected ? 'bg-teal-600' : 'bg-teal-50'}`}
                  >
                    <Text className={`text-[11px] font-semibold ${selected ? 'text-white' : 'text-teal-700'}`}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View className="h-px bg-border" />
          <View className="px-5 py-4 flex-row gap-2.5 items-start">
            <Ionicons name="information-circle-outline" size={16} color="#6B9E8A" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-text-muted leading-5">
              Choose the day of the week when the report is automatically sent to your household.
            </Text>
          </View>
        </View>

        {/* Report time */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden">
          <View className="px-5 pt-5 pb-5">
            <View className="flex-row items-center gap-3 mb-5">
              <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="time-outline" size={20} color="#1D9E75" />
              </View>
              <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider flex-1">
                Report time
              </Text>
              {(savingTime || settingsLoading) && <ActivityIndicator size="small" color="#1D9E75" />}
            </View>
            <View className="flex-row items-center justify-center gap-3">
              {/* Hour */}
              <View className="items-center gap-2">
                <TouchableOpacity
                  onPress={() => changeHour(1)}
                  disabled={settingsLoading}
                  className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-up" size={18} color="#1D9E75" />
                </TouchableOpacity>
                <Text className="text-[28px] font-semibold text-text-primary w-14 text-center">
                  {String(hour).padStart(2, '0')}
                </Text>
                <TouchableOpacity
                  onPress={() => changeHour(-1)}
                  disabled={settingsLoading}
                  className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={18} color="#1D9E75" />
                </TouchableOpacity>
              </View>

              <Text className="text-[28px] font-semibold text-text-muted pb-1">:</Text>

              {/* Minute */}
              <View className="items-center gap-2">
                <TouchableOpacity
                  onPress={() => changeMinute(1)}
                  disabled={settingsLoading}
                  className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-up" size={18} color="#1D9E75" />
                </TouchableOpacity>
                <Text className="text-[28px] font-semibold text-text-primary w-14 text-center">
                  {String(minute).padStart(2, '0')}
                </Text>
                <TouchableOpacity
                  onPress={() => changeMinute(-1)}
                  disabled={settingsLoading}
                  className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center"
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={18} color="#1D9E75" />
                </TouchableOpacity>
              </View>

              {/* AM / PM */}
              <View className="gap-2 ml-2">
                <TouchableOpacity
                  onPress={() => handleToggleAmPm(false)}
                  disabled={settingsLoading}
                  className={`w-14 h-[38px] rounded-xl items-center justify-center ${!isPM ? 'bg-teal-600' : 'bg-teal-50'}`}
                  activeOpacity={0.75}
                >
                  <Text className={`text-[13px] font-semibold ${!isPM ? 'text-white' : 'text-teal-700'}`}>AM</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleToggleAmPm(true)}
                  disabled={settingsLoading}
                  className={`w-14 h-[38px] rounded-xl items-center justify-center ${isPM ? 'bg-teal-600' : 'bg-teal-50'}`}
                  activeOpacity={0.75}
                >
                  <Text className={`text-[13px] font-semibold ${isPM ? 'text-white' : 'text-teal-700'}`}>PM</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View className="h-px bg-border" />
          <View className="px-5 py-4 flex-row gap-2.5 items-start">
            <Ionicons name="information-circle-outline" size={16} color="#6B9E8A" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-text-muted leading-5">
              Minutes adjust in 5-minute steps. Changes save automatically.
            </Text>
          </View>
        </View>

        {/* Timezone card */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden">
          <TouchableOpacity
            className="px-5 pt-5 pb-5"
            onPress={() => setTzModalOpen(true)}
            disabled={settingsLoading}
            activeOpacity={0.7}
          >
            <View className="flex-row items-center gap-3 mb-3">
              <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="globe-outline" size={20} color="#1D9E75" />
              </View>
              <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider flex-1">
                Time zone
              </Text>
              {settingsLoading || savingTz
                ? <ActivityIndicator size="small" color="#1D9E75" />
                : <Ionicons name="chevron-forward" size={16} color="#D6EDE5" />
              }
            </View>
            <Text className="text-[16px] font-semibold text-text-primary">{tzLabel(timezone)}</Text>
            <Text className="text-[12px] text-text-muted mt-0.5">
              {timezone}{tzOffset(timezone) ? ` · ${tzOffset(timezone)}` : ''}
            </Text>
          </TouchableOpacity>
          <View className="h-px bg-border" />
          <View className="px-5 py-4 flex-row gap-2.5 items-start">
            <Ionicons name="information-circle-outline" size={16} color="#6B9E8A" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-text-muted leading-5">
              The report is scheduled in this time zone. Auto-detected from your device on first save.
            </Text>
          </View>
        </View>

        {/* Change email hint */}
        <View className="bg-teal-50 border border-teal-600/15 rounded-2xl px-5 py-4 gap-2">
          <View className="flex-row items-center gap-2">
            <Ionicons name="pencil-outline" size={16} color="#1D9E75" />
            <Text className="text-[13px] font-semibold text-teal-800">Want to change the email?</Text>
          </View>
          <Text className="text-[12px] text-teal-700 leading-5">
            Update your email in Edit profile. The weekly report will automatically be sent to the new address.
          </Text>
          <TouchableOpacity
            className="mt-1 self-start bg-teal-600 rounded-xl px-4 py-2.5"
            onPress={() => router.push('/edit-profile')}
            activeOpacity={0.85}
          >
            <Text className="text-[13px] font-semibold text-white">Edit profile</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Timezone picker modal */}
      <Modal
        visible={tzModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setTzModalOpen(false); setTzSearch(''); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F7F5' }}>
            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
              backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E8EFE8', gap: 12,
            }}>
              <Text style={{ flex: 1, fontSize: 18, fontWeight: '500', color: '#1A2E1A' }}>
                Select time zone
              </Text>
              <TouchableOpacity onPress={() => { setTzModalOpen(false); setTzSearch(''); }} hitSlop={8}>
                <Ionicons name="close" size={22} color="#3D6B55" />
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={{
              paddingHorizontal: 16, paddingVertical: 12,
              backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E8EFE8',
            }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#F0F6F3', borderRadius: 12, paddingHorizontal: 12, gap: 8,
              }}>
                <Ionicons name="search-outline" size={16} color="#6B9E8A" />
                <TextInput
                  value={tzSearch}
                  onChangeText={setTzSearch}
                  placeholder="Search city or region…"
                  placeholderTextColor="#6B9E8A"
                  style={{ flex: 1, paddingVertical: 10, fontSize: 14, color: '#1A2E1A' }}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {tzSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setTzSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color="#6B9E8A" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* List */}
            <FlatList
              data={filteredTz}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => {
                const selected = item.value === timezone;
                return (
                  <TouchableOpacity
                    onPress={() => handleSelectTimezone(item.value)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 20, paddingVertical: 14,
                      backgroundColor: selected ? '#F0FAF5' : '#F5F7F5',
                      borderBottomWidth: 1, borderBottomColor: '#E8EFE8', gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: selected ? '600' : '400', color: selected ? '#1D9E75' : '#1A2E1A' }}>
                        {item.label}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#6B9E8A', marginTop: 1 }}>
                        {item.value} · {item.offset}
                      </Text>
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={20} color="#1D9E75" />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 48 }}>
                  <Ionicons name="search-outline" size={32} color="#6B9E8A" />
                  <Text style={{ marginTop: 12, fontSize: 14, color: '#6B9E8A' }}>
                    No results for "{tzSearch}"
                  </Text>
                </View>
              }
            />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
