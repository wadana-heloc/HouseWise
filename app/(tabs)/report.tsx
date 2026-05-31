import { View, Text, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const REPORT = {
  week: 'Week of 19 May 2026',
  status: 'ready' as 'ready' | 'pending',
  totalAED: 312,
  stores: [
    {
      name: 'Carrefour',
      total: 148,
      items: [
        { name: 'Whole milk 2L', price: 12.5,  size: '2L',   pricePerUnit: '6.25/L',  health: 'standard', qty: 2 },
        { name: 'Greek yogurt',  price: 18.75, size: '500g', pricePerUnit: '37.5/kg', health: 'healthy',  qty: 3 },
        { name: 'Eggs 30-pack',  price: 28.0,  size: '30pk', pricePerUnit: '0.93/egg',health: 'standard', qty: 1 },
      ],
    },
    {
      name: 'Lulu',
      total: 97,
      items: [
        { name: 'Brown rice 5kg',    price: 34.5, size: '5kg',  pricePerUnit: '6.9/kg',  health: 'healthy',  qty: 1 },
        { name: 'Chicken breast 1kg',price: 29.9, size: '1kg',  pricePerUnit: '29.9/kg', health: 'healthy',  qty: 2 },
      ],
    },
    {
      name: 'Spinneys',
      total: 67,
      items: [
        { name: 'Olive oil 750ml',    price: 42.0, size: '750ml', pricePerUnit: '56/L',   health: 'healthy',  qty: 1 },
        { name: 'Whole wheat bread',  price: 12.5, size: '800g',  pricePerUnit: '15.6/kg',health: 'healthy',  qty: 2 },
      ],
    },
  ],
  approvals: [
    { name: 'Ahmad', approved: true },
    { name: 'Sara',  approved: true },
    { name: 'Maha',  approved: false },
  ],
};

export default function ReportScreen() {
  const router = useRouter();
  const pendingApprovals = REPORT.approvals.filter((a) => !a.approved).length;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border">
        <View className="flex-row items-center justify-between">
          <Text className="text-[22px] font-medium text-text-primary">Weekly report</Text>
          <View className={`px-3 py-1 rounded-full ${REPORT.status === 'ready' ? 'bg-teal-50' : 'bg-amber-100'}`}>
            <Text className={`text-[12px] font-medium ${REPORT.status === 'ready' ? 'text-teal-600' : 'text-amber-800'}`}>
              {REPORT.status === 'ready' ? '✓ Ready to approve' : 'Pending'}
            </Text>
          </View>
        </View>
        <Text className="text-[13px] text-text-muted mt-1">{REPORT.week}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16 }}>

        {/* Summary card */}
        <View className="bg-teal-600 rounded-2xl p-4">
          <Text className="text-[13px] text-white opacity-75 mb-1">Estimated total</Text>
          <Text className="text-[32px] font-medium text-white">AED {REPORT.totalAED}</Text>
          <View className="flex-row gap-2 mt-3 flex-wrap">
            {REPORT.stores.map((s) => (
              <View key={s.name} className="bg-white/20 rounded-lg px-3 py-1.5">
                <Text className="text-[12px] text-white">{s.name}  AED {s.total}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Approvals */}
        <View className="bg-white border border-border rounded-xl p-4">
          <Text className="text-[13px] font-medium text-text-muted uppercase tracking-wider mb-3">Member approvals</Text>
          <View className="gap-2">
            {REPORT.approvals.map((a) => (
              <View key={a.name} className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-teal-50 items-center justify-center">
                    <Text className="text-[11px] font-medium text-teal-600">{a.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <Text className="text-[14px] text-text-primary">{a.name}</Text>
                </View>
                <View className={`flex-row items-center gap-1 px-2.5 py-1 rounded-full ${a.approved ? 'bg-teal-50' : 'bg-amber-100'}`}>
                  <Ionicons name={a.approved ? 'checkmark-circle' : 'time-outline'} size={13} color={a.approved ? '#1D9E75' : '#92400E'} />
                  <Text className={`text-[11px] font-medium ${a.approved ? 'text-teal-600' : 'text-amber-800'}`}>
                    {a.approved ? 'Approved' : 'Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Items by store */}
        {REPORT.stores.map((store) => (
          <View key={store.name} className="bg-white border border-border rounded-xl overflow-hidden">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
              <Text className="text-[15px] font-medium text-text-primary">{store.name}</Text>
              <Text className="text-[14px] font-medium text-teal-600">AED {store.total}</Text>
            </View>
            {store.items.map((item, i) => (
              <View key={item.name} className={`px-4 py-3 flex-row items-center gap-3 ${i < store.items.length - 1 ? 'border-b border-border' : ''}`}>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-[14px] text-text-primary">{item.name}</Text>
                    {item.health === 'healthy' && (
                      <View className="bg-teal-50 rounded px-1.5 py-0.5">
                        <Text className="text-[10px] font-medium text-teal-600">Healthy</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-[12px] text-text-faint mt-0.5">{item.size} · {item.pricePerUnit} · qty {item.qty}</Text>
                </View>
                <Text className="text-[14px] font-medium text-text-primary">AED {item.price}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Approve CTA */}
        <TouchableOpacity
          className="bg-teal-600 rounded-xl py-4 items-center"
          onPress={() => router.push('/weekly-approval')}
          activeOpacity={0.85}
        >
          <Text className="text-[16px] font-semibold text-white">
            {pendingApprovals > 0 ? `Waiting for ${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''}` : 'Approve & confirm purchase'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}