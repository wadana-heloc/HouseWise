import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

type DayOfWeek = 'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

const REPORT_DAYS: { id: DayOfWeek; label: string; abbr: string; fetchDay: string }[] = [
  { id: 'saturday',  label: 'Saturday',  abbr: 'Sat', fetchDay: 'Friday'    },
  { id: 'sunday',    label: 'Sunday',    abbr: 'Sun', fetchDay: 'Saturday'  },
  { id: 'monday',    label: 'Monday',    abbr: 'Mon', fetchDay: 'Sunday'    },
  { id: 'tuesday',   label: 'Tuesday',   abbr: 'Tue', fetchDay: 'Monday'    },
  { id: 'wednesday', label: 'Wednesday', abbr: 'Wed', fetchDay: 'Tuesday'   },
  { id: 'thursday',  label: 'Thursday',  abbr: 'Thu', fetchDay: 'Wednesday' },
  { id: 'friday',    label: 'Friday',    abbr: 'Fri', fetchDay: 'Thursday'  },
];

const STORES = [
  { id: '1', name: 'Carrefour UAE',  icon: 'storefront-outline' },
  { id: '2', name: 'Lulu Hypermarket',icon: 'storefront-outline' },
  { id: '3', name: 'Union Coop',     icon: 'storefront-outline' },
  { id: '4', name: 'Spinneys',       icon: 'storefront-outline' },
];


export default function SettingsScreen() {
  const router = useRouter();
  const [selectedStores, setSelectedStores] = useState(['1', '2', '4']);
  const [reportDay, setReportDay] = useState<DayOfWeek>('friday');

  function toggleStore(id: string) {
    setSelectedStores((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function handleSave() {
    Alert.alert('Saved', 'Your household settings have been updated.');
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="text-[20px] font-medium text-text-primary">Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 24 }}>

        {/* Preferred stores */}
        <View className="gap-3">
          <View>
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Preferred stores</Text>
            <Text className="text-[12px] text-text-faint mt-1">AI will only compare prices at selected stores</Text>
          </View>
          <View className="bg-white border border-border rounded-xl overflow-hidden">
            {STORES.map((store, i) => (
              <TouchableOpacity
                key={store.id}
                className={`flex-row items-center px-4 py-3.5 gap-3 ${i < STORES.length - 1 ? 'border-b border-border' : ''}`}
                onPress={() => toggleStore(store.id)}
                activeOpacity={0.7}
              >
                <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                  <Ionicons name={store.icon as any} size={17} color="#1D9E75" />
                </View>
                <Text className="flex-1 text-[14px] text-text-primary">{store.name}</Text>
                <View className={`w-6 h-6 rounded-md border-2 items-center justify-center ${selectedStores.includes(store.id) ? 'bg-teal-600 border-teal-600' : 'border-border'}`}>
                  {selectedStores.includes(store.id) && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            className="flex-row items-center gap-2 px-1"
            onPress={() => Alert.alert('Suggest a store', 'This feature will send a request to the HouseWise team to add a new store.')}
          >
            <Ionicons name="add-circle-outline" size={16} color="#1D9E75" />
            <Text className="text-[13px] text-teal-600 font-medium">Suggest a new store</Text>
          </TouchableOpacity>
        </View>

        {/* Report schedule */}
        <View className="gap-3">
          <View>
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Report day</Text>
            <Text className="text-[12px] text-text-faint mt-1">Choose which day your household receives the weekly report</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {REPORT_DAYS.map((day) => (
              <TouchableOpacity
                key={day.id}
                className={`px-4 py-2.5 rounded-xl border ${reportDay === day.id ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                onPress={() => setReportDay(day.id)}
                activeOpacity={0.7}
              >
                <Text className={`text-[13px] font-medium ${reportDay === day.id ? 'text-white' : 'text-text-muted'}`}>{day.abbr}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(() => {
            const selected = REPORT_DAYS.find((d) => d.id === reportDay)!;
            return (
              <Text className="text-[12px] text-text-faint px-1">
                Prices fetched {selected.fetchDay} night, report sent {selected.label} morning.
              </Text>
            );
          })()}
        </View>

        {/* Save */}
        <TouchableOpacity
          className="bg-teal-600 rounded-xl py-4 items-center"
          onPress={handleSave}
          activeOpacity={0.85}
        >
          <Text className="text-[16px] font-semibold text-white">Save settings</Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}