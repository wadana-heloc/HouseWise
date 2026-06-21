import { useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Pressable,
    Animated,
    Easing,
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
                <GreetingCard
                    greeting={greeting}
                    name={name}
                    items={items}
                    doneCount={doneCount}
                    urgentCount={urgentCount}
                    loading={loading}
                />

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
                            icon="camera-outline"
                            label="Scan photo"
                            sub="Photograph product"
                            onPress={() => router.push('/image-scan')}
                        />
                        {/* <QuickAction
                            icon="settings-outline"
                            label="Settings"
                            sub="Stores & health prefs"
                            onPress={() => router.push('/settings')}
                        /> */}
                        <QuickAction
                            icon="book-outline"
                            label="Cookbook"
                            sub="Manage recipes"
                            onPress={() => router.push('/cookbook')}
                        />
                        <QuickAction
                            icon="calendar-outline"
                            label="Meal Plan"
                            sub="Plan the week"
                            onPress={() => router.push('/meal-plan')}
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
                                        {isOwn ? 'You' : (members.find((m) => m.id === item.added_by)?.display_name ?? 'Member')} · {item.quantity} {item.unit}
                                    </Text>
                                </View>

                                <View className="flex-row items-center gap-2">
                                    {item.urgent && !isDone && (
                                        <View className="bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5">
                                            <Text className="text-[10px] font-semibold text-amber-600">Urgent</Text>
                                        </View>
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

function GreetingCard({
    greeting, name, items, doneCount, urgentCount, loading,
}: {
    greeting: string;
    name: string;
    items: Item[];
    doneCount: number;
    urgentCount: number;
    loading: boolean;
}) {
    const progress = items.length > 0 ? doneCount / items.length : 0;

    const cardAnim     = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim    = useRef(new Animated.Value(1)).current;
    const pulseLoop    = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        Animated.spring(cardAnim, {
            toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true,
        }).start();
    }, []);

    useEffect(() => {
        if (!loading && items.length > 0) {
            Animated.sequence([
                Animated.delay(400),
                Animated.timing(progressAnim, {
                    toValue: progress,
                    duration: 900,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                }),
            ]).start();
        }
    }, [loading, progress]);

    useEffect(() => {
        pulseLoop.current?.stop();
        if (urgentCount > 0) {
            pulseLoop.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.12, duration: 650, useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1,    duration: 650, useNativeDriver: true }),
                ]),
            );
            pulseLoop.current.start();
        } else {
            Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
    }, [urgentCount]);

    const cardStyle = {
        opacity: cardAnim,
        transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
    };

    const barStyle = {
        width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
    };

    const pulseStyle = {
        transform: [{ scale: pulseAnim }],
    };

    return (
        <Animated.View style={[cardStyle, {
            marginHorizontal: 20, marginTop: 16, borderRadius: 16,
            padding: 20, backgroundColor: '#0d9488', overflow: 'hidden',
        }]}>
            {/* decorative blobs */}
            <View style={{ position: 'absolute', top: -28, right: -28, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ position: 'absolute', bottom: -20, right: 40,  width: 72,  height: 72,  borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <View style={{ position: 'absolute', top: 16,   right: 80,    width: 36,  height: 36,  borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)' }} />

            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '500' }}>{greeting}</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '600', marginTop: 2 }}>{name} 👋</Text>

            {!loading && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>{items.length} items</Text>
                    </View>
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '500' }}>{doneCount} done</Text>
                    </View>
                    {urgentCount > 0 && (
                        <Animated.View style={[pulseStyle, { backgroundColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }]}>
                            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>⚡ {urgentCount} urgent</Text>
                        </Animated.View>
                    )}
                </View>
            )}

            {!loading && items.length > 0 && (
                <View style={{ marginTop: 16 }}>
                    <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, overflow: 'hidden' }}>
                        <Animated.View style={[barStyle, { height: 6, backgroundColor: '#fff', borderRadius: 999 }]} />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>Shopping progress</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '500' }}>{Math.round(progress * 100)}% complete</Text>
                    </View>
                </View>
            )}

            {loading && (
                <View style={{ marginTop: 16, height: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999 }} />
            )}
        </Animated.View>
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
        <Pressable
            className="bg-white border border-border rounded-xl p-3.5 flex-col gap-2"
            style={({ pressed }) => ({
                width: '47.5%',
                transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
            onPress={onPress}
        >
            <View className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name={icon} size={20} color="#1D9E75" />
            </View>
            <Text className="text-[13px] font-medium text-text-primary">{label}</Text>
            <Text className="text-[12px] text-text-faint -mt-1.5">{sub}</Text>
        </Pressable>
    );
}
