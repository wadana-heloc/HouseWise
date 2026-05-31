import { useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StatusBar,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useItemStore } from '../../store/itemStore';
import { useMemberStore } from '../../store/memberStore';
import { useLowStockStore } from '../../store/lowStockStore';
import type { Item } from '../../services/items';

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');
}

export default function HomeScreen() {
    const router = useRouter();
    const { displayName, userId, role } = useAuthStore();
    const isAdmin = role === 'admin';
    const name = displayName ?? 'User';
    const initials = getInitials(name);
    const greeting = getGreeting();

    const { items, loading, fetchItems, updateStatus, deleteItem } = useItemStore();
    const { members, fetchMembers } = useMemberStore();
    const { flags, loading: flagsLoading, fetchFlags } = useLowStockStore();

    useFocusEffect(
        useCallback(() => {
            fetchItems();
            fetchMembers();
            fetchFlags();
        }, []),
    );

    const preview     = items.slice(0, 4);
    const urgentCount = items.filter((i) => i.urgent && i.status !== 'done').length;
    const doneCount   = items.filter((i) => i.status === 'done').length;

    function canDelete(addedBy: string) {
        return isAdmin || addedBy === userId;
    }

    function toggleDone(item: Item) {
        const next = item.status === 'done' ? 'pending' : 'done';
        updateStatus(item.id, next).catch(() =>
            Alert.alert('Error', 'Could not update item. Try again.'),
        );
    }

    function confirmDelete(id: string, itemName: string, addedBy: string) {
        if (!canDelete(addedBy)) {
            Alert.alert('Not allowed', 'Only the person who added this item or an admin can remove it.');
            return;
        }
        Alert.alert('Remove item', `Remove "${itemName}" from the list?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove', style: 'destructive',
                onPress: () => deleteItem(id).catch(() =>
                    Alert.alert('Error', 'Could not remove item. Try again.'),
                ),
            },
        ]);
    }

    return (
        <SafeAreaView className="flex-1 bg-bg-primary">
            <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

            {/* ── Top bar ── */}
            <View className="flex-row items-center justify-between px-5 py-3 bg-white border-b border-border">
                <View className="flex-row items-center gap-2.5">
                    <View className="w-9 h-9 rounded-xl bg-teal-600 items-center justify-center">
                        <Ionicons name="home" size={18} color="#fff" />
                    </View>
                    <Text className="text-[17px] font-medium text-text-primary">HouseWise</Text>
                </View>
                <View className="flex-row items-center gap-2.5">
                    <TouchableOpacity onPress={() => Alert.alert('Notifications', 'No new notifications.')}>
                        <Ionicons name="notifications-outline" size={22} color="#7AAA96" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        className="w-9 h-9 rounded-full bg-teal-50 items-center justify-center"
                        onPress={() => router.push('/(tabs)/profile')}
                    >
                        <Text className="text-[13px] font-medium text-teal-600">{initials}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>

                {/* ── Greeting card ── */}
                <View className="mx-5 mt-4 bg-white border border-border rounded-2xl p-4 flex-row items-center justify-between">
                    <View>
                        <Text className="text-[20px] font-medium text-text-primary">{greeting}, {name} 👋</Text>
                        <Text className="text-[13px] text-text-muted mt-1">
                            {loading
                                ? 'Loading list…'
                                : `${items.length} items · ${doneCount} done${urgentCount > 0 ? ` · ${urgentCount} urgent` : ''}`
                            }
                        </Text>
                    </View>
                </View>

                {/* ── Quick actions ── */}
                <View className="px-5 mt-5">
                    <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">Quick actions</Text>
                    <View className="flex-row flex-wrap gap-2.5">
                        <QuickAction
                            icon="add-circle-outline"
                            label="Add item"
                            sub="To shopping list"
                            onPress={() => router.push('/(tabs)/add-item')}
                        />
                        <QuickAction
                            icon="barcode-outline"
                            label="Scan barcode"
                            sub="Identify product"
                            onPress={() => router.push('/barcode-confirm')}
                        />
                        <QuickAction
                            icon="document-text-outline"
                            label="Weekly report"
                            sub="Review & approve"
                            onPress={() => router.push('/weekly-approval')}
                        />
                        <QuickAction
                            icon="settings-outline"
                            label="Settings"
                            sub="Stores & health prefs"
                            onPress={() => router.push('/settings')}
                        />
                    </View>
                </View>

                {/* ── Shopping list ── */}
                <View className="px-5 mt-6">
                    <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase">Shopping list</Text>
                        <TouchableOpacity onPress={() => router.push('/(tabs)/list')}>
                            <Text className="text-[13px] font-medium text-teal-600">
                                See all ({items.length})
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {loading && (
                        <View className="bg-white border border-border rounded-xl py-8 items-center gap-2">
                            <ActivityIndicator size="small" color="#1D9E75" />
                            <Text className="text-[13px] text-text-muted">Loading items…</Text>
                        </View>
                    )}

                    {!loading && items.length === 0 && (
                        <View className="bg-white border border-border rounded-xl py-8 items-center gap-2">
                            <Ionicons name="basket-outline" size={28} color="#D6EDE5" />
                            <Text className="text-[13px] text-text-muted">No items yet</Text>
                        </View>
                    )}

                    {!loading && preview.map((item) => {
                        const isDone    = item.status === 'done';
                        const isOwn     = item.added_by === userId;
                        const deletable = canDelete(item.added_by);

                        return (
                            <View
                                key={item.id}
                                className="bg-white border border-border rounded-xl px-4 py-3 flex-row items-center gap-3 mb-2"
                            >
                                <TouchableOpacity
                                    className={`w-6 h-6 rounded-md border-2 items-center justify-center ${isDone ? 'bg-teal-600 border-teal-600' : 'border-border'}`}
                                    onPress={() => toggleDone(item)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    {isDone && <Ionicons name="checkmark" size={14} color="#fff" />}
                                </TouchableOpacity>

                                <View className="flex-1">
                                    <Text className={`text-[14px] font-medium ${isDone ? 'line-through text-text-faint' : 'text-text-primary'}`}>
                                        {item.name}
                                    </Text>
                                    <Text className="text-[12px] text-text-faint mt-0.5">
                                        {isOwn ? 'You' : 'Member'} · {item.quantity} {item.unit}
                                    </Text>
                                </View>

                                <View className="flex-row items-center gap-2">
                                    {item.urgent && !isDone && (
                                        <View className="w-2 h-2 rounded-full bg-amber-400" />
                                    )}
                                    <TouchableOpacity
                                        onPress={() => confirmDelete(item.id, item.name, item.added_by)}
                                        className={`w-6 h-6 rounded-full bg-bg-primary items-center justify-center ${!deletable ? 'opacity-25' : ''}`}
                                        activeOpacity={deletable ? 0.7 : 1}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Ionicons name="close" size={14} color="#A8C4B8" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        );
                    })}

                    {!loading && urgentCount > 0 && (
                        <View className="flex-row items-center gap-1.5 py-1">
                            <View className="w-2 h-2 rounded-full bg-amber-400" />
                            <Text className="text-[12px] text-amber-700">
                                {urgentCount} urgent {urgentCount === 1 ? 'item needs' : 'items need'} attention
                            </Text>
                        </View>
                    )}
                </View>

                {/* ── Weekly report ── */}
                <View className="px-5 mt-6">
                    <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">Weekly report</Text>
                    <View className="bg-white border border-border rounded-2xl p-4">
                        <TouchableOpacity
                            className="bg-teal-600 rounded-xl py-4 flex-row items-center justify-center gap-2 mx-5 mt-4"
                            onPress={() => router.push('/generate-report')}
                        >
                            <Ionicons name="sparkles-outline" size={20} color="#fff" />
                            <Text className="text-[16px] font-semibold text-white">Generate Report</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* ── Low stock ── */}
                <View className="px-5 mt-6">
                    <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase">
                            Low stock {flags.length > 0 ? `(${flags.length})` : ''}
                        </Text>
                        <TouchableOpacity onPress={() => router.push('/low-stock')}>
                            <Text className="text-[13px] font-medium text-teal-600">Manage</Text>
                        </TouchableOpacity>
                    </View>
                    <View className="bg-white border border-border rounded-xl px-4">
                        {flagsLoading && (
                            <View className="py-4 items-center">
                                <ActivityIndicator size="small" color="#1D9E75" />
                            </View>
                        )}
                        {!flagsLoading && flags.length === 0 && (
                            <View className="py-4 items-center">
                                <Text className="text-[13px] text-text-faint">All stocked up!</Text>
                            </View>
                        )}
                        {!flagsLoading && flags.slice(0, 3).map((flag, i) => {
                            const preview = flags.slice(0, 3);
                            return (
                                <View
                                    key={flag.id}
                                    className={`flex-row items-center gap-3 py-3 ${i < preview.length - 1 ? 'border-b border-border' : ''}`}
                                >
                                    <View className="w-2 h-2 rounded-full bg-amber-400" />
                                    <Text className="flex-1 text-[14px] text-text-primary" numberOfLines={1}>{flag.name}</Text>
                                    <Text className="text-[12px] text-text-faint">
                                        {flag.added_by === userId ? 'Flagged by you' : `Flagged by ${flag.added_by_display_name}`}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                </View>

                {/* ── Household members ── */}
                <View className="px-5 mt-6">
                    <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase">Household members</Text>
                        <TouchableOpacity onPress={() => router.push('/manage-members')}>
                            <Text className="text-[13px] font-medium text-teal-600">Manage</Text>
                        </TouchableOpacity>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                        {members.map((m) => (
                            <View key={m.id} className="flex-row items-center gap-2 bg-white border border-border rounded-full px-3 py-1.5">
                                <View className="w-7 h-7 rounded-full bg-teal-50 items-center justify-center">
                                    <Text className="text-[11px] font-medium text-teal-600">{getInitials(m.display_name)}</Text>
                                </View>
                                <View>
                                    <Text className="text-[13px] text-text-primary">{m.display_name}</Text>
                                    <Text className="text-[11px] text-text-muted capitalize">{m.role}</Text>
                                </View>
                            </View>
                        ))}
                        <TouchableOpacity
                            className="flex-row items-center gap-2 bg-teal-50 border border-teal-600/20 rounded-full px-3 py-1.5"
                            onPress={() => router.push('/add-member')}
                        >
                            <Ionicons name="person-add-outline" size={15} color="#1D9E75" />
                            <Text className="text-[13px] font-medium text-teal-600">Add member</Text>
                        </TouchableOpacity>
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

function QuickAction({
    icon, label, sub, onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    sub: string;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            className="bg-white border border-border rounded-xl p-3.5 flex-col gap-2"
            style={{ width: '47.5%' }}
            onPress={onPress}
            activeOpacity={0.75}
        >
            <View className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name={icon} size={20} color="#1D9E75" />
            </View>
            <Text className="text-[13px] font-medium text-text-primary">{label}</Text>
            <Text className="text-[12px] text-text-faint -mt-1.5">{sub}</Text>
        </TouchableOpacity>
    );
}
