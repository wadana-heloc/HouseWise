import { useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Animated,
    Easing,
    StatusBar,
    Alert,
    StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useItemStore } from '../../store/itemStore';
import { useMemberStore } from '../../store/memberStore';
import { useLowStockStore } from '../../store/lowStockStore';
import type { Item } from '../../services/items';
import type { Member } from '../../services/members';
import type { LowStockFlag } from '../../services/lowStock';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextReportDate(): string {
    const now = new Date();
    const daysUntilSunday = now.getDay() === 0 ? 7 : 7 - now.getDay();
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilSunday);
    return next.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getGreetingEmoji(): string {
    const h = new Date().getHours();
    if (h < 12) return '☀️';
    if (h < 17) return '🌤️';
    return '🌙';
}

function getInitials(name: string): string {
    return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_PALETTE = [
    { bg: '#E1F5EE', text: '#0F6E56' },
    { bg: '#FEF3C7', text: '#B45309' },
    { bg: '#EDE9FE', text: '#6D28D9' },
    { bg: '#FCE7F3', text: '#9D174D' },
    { bg: '#DBEAFE', text: '#1E40AF' },
    { bg: '#D1FAE5', text: '#065F46' },
];

function avatarColor(name: string) {
    return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

// ─── Skeleton shimmer ────────────────────────────────────────────────────────

function Shimmer({ height = 16, width = '100%' as number | string, radius = 8, style = {} as object }) {
    const anim = useRef(new Animated.Value(0.35)).current;
    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(anim, { toValue: 0.9, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                Animated.timing(anim, { toValue: 0.35, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
        ).start();
    }, []);
    return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: '#D6EDE5' }, style, { opacity: anim }]} />;
}

// ─── Staggered entrance ──────────────────────────────────────────────────────

function Entrance({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
    const anim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.sequence([
            Animated.delay(delay),
            Animated.spring(anim, { toValue: 1, damping: 22, stiffness: 240, useNativeDriver: true }),
        ]).start();
    }, []);
    return (
        <Animated.View style={{
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        }}>
            {children}
        </Animated.View>
    );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    return (
        <View style={s.secHeader}>
            <View style={s.secTitleRow}>
                <View style={s.secAccent} />
                <Text style={s.secTitle}>{title}</Text>
            </View>
            {action && onAction && (
                <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.secAction}>{action}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

// ─── Greeting card ───────────────────────────────────────────────────────────

function GreetingCard({
    greeting, emoji, name, items, doneCount, urgentCount, loading,
}: {
    greeting: string; emoji: string; name: string;
    items: Item[]; doneCount: number; urgentCount: number; loading: boolean;
}) {
    const progress = items.length > 0 ? doneCount / items.length : 0;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim    = useRef(new Animated.Value(1)).current;
    const pulseRef     = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        if (!loading && items.length > 0) {
            Animated.sequence([
                Animated.delay(350),
                Animated.timing(progressAnim, {
                    toValue: progress,
                    duration: 1100,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                }),
            ]).start();
        }
    }, [loading, progress]);

    useEffect(() => {
        pulseRef.current?.stop();
        if (urgentCount > 0) {
            pulseRef.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.08, duration: 680, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1,    duration: 680, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                ]),
            );
            pulseRef.current.start();
        } else {
            Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
        return () => pulseRef.current?.stop();
    }, [urgentCount]);

    const barW = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

    return (
        <View style={s.greetCard}>
            {/* Decorative circles */}
            <View style={[s.blob, { width: 160, height: 160, top: -50, right: -50, opacity: 0.10 }]} />
            <View style={[s.blob, { width: 100, height: 100, bottom: -35, right: 24, opacity: 0.07 }]} />
            <View style={[s.blob, { width: 56, height: 56, top: 18, right: 96, opacity: 0.06 }]} />
            <View style={[s.blob, { width: 72, height: 72, top: 72, left: -24, opacity: 0.08 }]} />

            {/* Greeting row */}
            <View style={s.greetRow}>
                <Text style={s.greetEmoji}>{emoji}</Text>
                <Text style={s.greetSub}>{greeting}</Text>
            </View>
            <Text style={s.greetName}>{name}</Text>

            {/* Stat pills */}
            {loading ? (
                <View style={s.pillRow}>
                    <Shimmer height={28} width={80} radius={14} style={{ backgroundColor: 'rgba(255,255,255,0.22)' }} />
                    <Shimmer height={28} width={72} radius={14} style={{ backgroundColor: 'rgba(255,255,255,0.22)' }} />
                </View>
            ) : (
                <View style={s.pillRow}>
                    <View style={s.pill}>
                        <Ionicons name="list-outline" size={12} color="rgba(255,255,255,0.85)" />
                        <Text style={s.pillText}>{items.length} items</Text>
                    </View>
                    <View style={s.pill}>
                        <Ionicons name="checkmark-circle-outline" size={12} color="rgba(255,255,255,0.85)" />
                        <Text style={s.pillText}>{doneCount} done</Text>
                    </View>
                    {urgentCount > 0 && (
                        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                            <View style={[s.pill, s.pillUrgent]}>
                                <Text style={s.pillText}>⚡ {urgentCount} urgent</Text>
                            </View>
                        </Animated.View>
                    )}
                </View>
            )}

            {/* Progress */}
            {!loading && items.length > 0 && (
                <View style={s.progWrap}>
                    <View style={s.progTrack}>
                        <Animated.View style={[s.progBar, { width: barW }]} />
                    </View>
                    <View style={s.progLabels}>
                        <Text style={s.progLabel}>Shopping progress</Text>
                        <Text style={s.progPct}>{Math.round(progress * 100)}%</Text>
                    </View>
                </View>
            )}
            {loading && (
                <View style={s.progWrap}>
                    <Shimmer height={6} radius={3} style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
                </View>
            )}
        </View>
    );
}

// ─── Quick action (horizontal scroll item) ───────────────────────────────────

const QUICK_ACTIONS: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    color: string;
    bg: string;
    route: string;
}[] = [
    { icon: 'add-circle-outline', label: 'Add Item',   color: '#1D9E75', bg: '#E1F5EE', route: '/(tabs)/add-item' },
    { icon: 'barcode-outline',    label: 'Scan',        color: '#7C3AED', bg: '#EDE9FE', route: '/barcode-confirm' },
    { icon: 'camera-outline',     label: 'Photo',       color: '#DB2777', bg: '#FCE7F3', route: '/image-scan' },
    { icon: 'book-outline',       label: 'Cook book',    color: '#D97706', bg: '#FEF3C7', route: '/cookbook' },
    { icon: 'calendar-outline',   label: 'Meal Plan',   color: '#1D4ED8', bg: '#DBEAFE', route: '/meal-plan' },
];

function QuickActions({ onPress }: { onPress: (route: string) => void }) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.qaScroll}
        >
            {QUICK_ACTIONS.map((qa) => (
                <QuickActionItem key={qa.route} {...qa} onPress={() => onPress(qa.route)} />
            ))}
        </ScrollView>
    );
}

function QuickActionItem({
    icon, label, color, bg, onPress,
}: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; color: string; bg: string; onPress: () => void }) {
    const scale = useRef(new Animated.Value(1)).current;
    const pressIn  = () => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start();
    const pressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true }).start();
    return (
        <TouchableOpacity onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} activeOpacity={1}>
            <Animated.View style={[s.qaCard, { transform: [{ scale }] }]}>
                <View style={[s.qaIconBox, { backgroundColor: bg }]}>
                    <Ionicons name={icon} size={24} color={color} />
                </View>
                <Text style={s.qaLabel}>{label}</Text>
            </Animated.View>
        </TouchableOpacity>
    );
}

// ─── Shopping list section ───────────────────────────────────────────────────

function ShoppingSection({
    loading, preview, allItems, urgentCount, userId, members, onToggle, onDelete, canDelete, onSeeAll,
}: {
    loading: boolean;
    preview: Item[];
    allItems: Item[];
    urgentCount: number;
    userId: string;
    members: Member[];
    onToggle: (item: Item) => void;
    onDelete: (id: string, name: string, addedBy: string) => void;
    canDelete: (addedBy: string) => boolean;
    onSeeAll: () => void;
}) {
    if (loading) {
        return (
            <View style={s.card}>
                {[0, 1, 2].map((i) => (
                    <View key={i} style={[s.itemRow, i < 2 && s.rowBorder]}>
                        <Shimmer height={22} width={22} radius={7} />
                        <View style={{ flex: 1, gap: 6 }}>
                            <Shimmer height={13} width="65%" radius={5} />
                            <Shimmer height={10} width="38%" radius={4} />
                        </View>
                    </View>
                ))}
            </View>
        );
    }

    if (allItems.length === 0) {
        return (
            <View style={s.emptyCard}>
                <Text style={s.emptyIcon}>🛒</Text>
                <Text style={s.emptyTitle}>Your list is empty</Text>
                <Text style={s.emptyBody}>Tap "Add Item" to get started</Text>
            </View>
        );
    }

    return (
        <>
            <View style={s.card}>
                {preview.map((item, i) => {
                    const done      = item.status === 'done';
                    const own       = item.added_by === userId;
                    const deletable = canDelete(item.added_by);
                    const who       = own ? 'You' : (members.find((m) => m.id === item.added_by)?.display_name ?? 'Member');
                    return (
                        <View key={item.id} style={[s.itemRow, i < preview.length - 1 && s.rowBorder]}>
                            <TouchableOpacity
                                style={[s.checkbox, done && s.checkboxDone]}
                                onPress={() => onToggle(item)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                {done && <Ionicons name="checkmark" size={13} color="#fff" />}
                            </TouchableOpacity>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={[s.itemName, done && s.itemDone]} numberOfLines={1}>
                                    {item.name}
                                </Text>
                                <Text style={s.itemMeta}>{who} · {item.quantity} {item.unit}</Text>
                            </View>
                            <View style={s.itemRight}>
                                {item.urgent && !done && (
                                    <View style={s.urgentBadge}>
                                        <Text style={s.urgentBadgeText}>⚡</Text>
                                    </View>
                                )}
                                <TouchableOpacity
                                    onPress={() => onDelete(item.id, item.name, item.added_by)}
                                    style={[s.delBtn, !deletable && { opacity: 0.25 }]}
                                    activeOpacity={deletable ? 0.7 : 1}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                    <Ionicons name="close" size={13} color="#A8C4B8" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    );
                })}
            </View>

            {urgentCount > 0 && (
                <View style={s.urgentBar}>
                    <View style={s.urgentDot} />
                    <Text style={s.urgentBarText}>
                        {urgentCount} urgent {urgentCount === 1 ? 'item needs' : 'items need'} attention
                    </Text>
                </View>
            )}

            {allItems.length > 4 && (
                <TouchableOpacity style={s.seeAllBtn} onPress={onSeeAll} activeOpacity={0.75}>
                    <Text style={s.seeAllText}>View all {allItems.length} items</Text>
                    <Ionicons name="chevron-forward" size={14} color="#1D9E75" />
                </TouchableOpacity>
            )}
        </>
    );
}

// ─── Low stock section ───────────────────────────────────────────────────────

function LowStockSection({ flags, loading, userId }: { flags: LowStockFlag[]; loading: boolean; userId: string }) {
    if (loading) {
        return (
            <View style={s.card}>
                {[0, 1].map((i) => (
                    <View key={i} style={[s.itemRow, i < 1 && s.rowBorder]}>
                        <Shimmer height={8} width={8} radius={4} />
                        <Shimmer height={13} width="55%" radius={5} />
                        <Shimmer height={10} width="28%" radius={4} />
                    </View>
                ))}
            </View>
        );
    }

    if (flags.length === 0) {
        return (
            <View style={s.emptyCard}>
                <Text style={s.emptyIcon}>✅</Text>
                <Text style={s.emptyTitle}>All stocked up!</Text>
                <Text style={s.emptyBody}>No items are running low right now</Text>
            </View>
        );
    }

    const shown = flags.slice(0, 3);
    return (
        <View style={s.card}>
            {shown.map((flag, i) => (
                <View key={flag.id} style={[s.itemRow, i < shown.length - 1 && s.rowBorder]}>
                    <View style={s.lowDot} />
                    <Text style={s.lowName} numberOfLines={1}>{flag.name}</Text>
                    <Text style={s.lowBy} numberOfLines={1}>
                        {flag.added_by === userId ? 'Flagged by you' : `By ${flag.added_by_display_name}`}
                    </Text>
                </View>
            ))}
        </View>
    );
}

// ─── Members section ─────────────────────────────────────────────────────────

function MembersSection({ members, onAdd }: { members: Member[]; onAdd: () => void }) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.membersScroll}
        >
            {members.map((m) => {
                const { bg, text } = avatarColor(m.display_name);
                return (
                    <View key={m.id} style={s.memberCard}>
                        <View style={[s.memberAvatar, { backgroundColor: bg }]}>
                            <Text style={[s.memberInitials, { color: text }]}>{getInitials(m.display_name)}</Text>
                        </View>
                        <Text style={s.memberName} numberOfLines={1}>{m.display_name.split(' ')[0]}</Text>
                        <View style={[s.memberRolePill, m.role === 'admin' && s.memberRoleAdmin]}>
                            <Text style={[s.memberRoleText, m.role === 'admin' && s.memberRoleAdminText]}>
                                {m.role}
                            </Text>
                        </View>
                    </View>
                );
            })}
            <TouchableOpacity onPress={onAdd} activeOpacity={0.75} style={s.addMemberCard}>
                <View style={s.addMemberIcon}>
                    <Ionicons name="person-add-outline" size={20} color="#1D9E75" />
                </View>
                <Text style={s.addMemberLabel}>Invite</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function HomeScreen() {
    const router  = useRouter();
    const { displayName, userId, role } = useAuthStore();
    const isAdmin = role === 'admin';
    const name    = displayName ?? 'User';

    const { items, loading, fetchItems, updateStatus, deleteItem } = useItemStore();
    const { members, fetchMembers }  = useMemberStore();
    const { flags, loading: flagsLoading, fetchFlags } = useLowStockStore();

    useFocusEffect(
        useCallback(() => {
            fetchItems();
            fetchMembers();
            fetchFlags();
        }, []),
    );

    const preview      = items.slice(0, 4);
    const urgentCount  = items.filter((i) => i.urgent && i.status !== 'done').length;
    const doneCount    = items.filter((i) => i.status === 'done').length;

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

    const initials = getInitials(name);
    const { bg: avBg, text: avText } = avatarColor(name);

    return (
        <SafeAreaView style={s.root}>
            <StatusBar barStyle="dark-content" backgroundColor="#fff" />

            {/* ── Header ── */}
            <View style={s.header}>
                <View style={s.headerLeft}>
                    <View style={s.logoBox}>
                        <Ionicons name="home" size={16} color="#fff" />
                    </View>
                    <Text style={s.appName}>HouseWise</Text>
                </View>
                <View style={s.headerRight}>
                    <TouchableOpacity
                        style={s.notifBtn}
                        onPress={() => Alert.alert('Notifications', 'No new notifications.')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="notifications-outline" size={20} color="#7AAA96" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[s.avatarBtn, { backgroundColor: avBg }]}
                        onPress={() => router.push('/(tabs)/profile')}
                    >
                        <Text style={[s.avatarText, { color: avText }]}>{initials}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* ── Scroll body ── */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>

                {/* Greeting */}
                <Entrance delay={40}>
                    <GreetingCard
                        greeting={getGreeting()}
                        emoji={getGreetingEmoji()}
                        name={name}
                        items={items}
                        doneCount={doneCount}
                        urgentCount={urgentCount}
                        loading={loading}
                    />
                </Entrance>

                {/* Quick actions */}
                <Entrance delay={100}>
                    <SectionHeader title="Quick Actions" />
                    <QuickActions onPress={(route) => router.push(route as any)} />
                </Entrance>

                {/* Shopping list */}
                <Entrance delay={160}>
                    <SectionHeader
                        title="Shopping List"
                        action={`See all (${items.length})`}
                        onAction={() => router.push('/(tabs)/list')}
                    />
                    <ShoppingSection
                        loading={loading}
                        preview={preview}
                        allItems={items}
                        urgentCount={urgentCount}
                        userId={userId ?? ''}
                        members={members}
                        onToggle={toggleDone}
                        onDelete={confirmDelete}
                        canDelete={canDelete}
                        onSeeAll={() => router.push('/(tabs)/list')}
                    />
                </Entrance>

                {/* Low stock */}
                <Entrance delay={220}>
                    <SectionHeader
                        title={`Low Stock${flags.length > 0 ? ` (${flags.length})` : ''}`}
                        action="Manage"
                        onAction={() => router.push('/low-stock')}
                    />
                    <LowStockSection flags={flags} loading={flagsLoading} userId={userId ?? ''} />
                </Entrance>

                {/* Members */}
                <Entrance delay={280}>
                    <SectionHeader
                        title="Household"
                        action="Manage"
                        onAction={() => router.push('/manage-members')}
                    />
                    <MembersSection members={members} onAdd={() => router.push('/add-member')} />
                </Entrance>

                {/* Weekly report */}
                <Entrance delay={340}>
                    <SectionHeader title="Weekly Report" />
                    <View style={s.reportCard}>
                        <View style={s.reportTop}>
                            <View style={s.reportIconBox}>
                                <Ionicons name="sparkles-outline" size={22} color={TEAL} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.reportTitle}>AI-generated summary</Text>
                                <Text style={s.reportSub}>Next delivery: {getNextReportDate()}</Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            style={s.reportBtn}
                            onPress={() => router.push('/generate-report')}
                            activeOpacity={0.82}
                        >
                            <Ionicons name="sparkles-outline" size={17} color="#fff" />
                            <Text style={s.reportBtnText}>Generate Report</Text>
                        </TouchableOpacity>
                    </View>
                </Entrance>

            </ScrollView>
        </SafeAreaView>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const TEAL     = '#1D9E75';
const TEAL_DK  = '#0d9488';
const TEAL_LT  = '#E1F5EE';
const BG       = '#F5F7F5';
const WHITE    = '#FFFFFF';
const BORDER   = '#D6EDE5';
const TXT_PRI  = '#0D2D1F';
const TXT_MUT  = '#7AAA96';
const TXT_FAINT = '#A8C4B8';
const AMBER    = '#FBBF24';

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },

    // Header
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 12,
        backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05, shadowRadius: 4, elevation: 3,
    },
    headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoBox: {
        width: 32, height: 32, borderRadius: 10,
        backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
    },
    appName: { fontSize: 16, fontWeight: '700', color: TXT_PRI, letterSpacing: -0.4 },
    notifBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: BG, alignItems: 'center', justifyContent: 'center',
    },
    avatarBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { fontSize: 12, fontWeight: '800' },

    scrollContent: { paddingBottom: 40 },

    // Section header
    secHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, marginTop: 28, marginBottom: 12,
    },
    secTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    secAccent:   { width: 3, height: 17, borderRadius: 2, backgroundColor: TEAL },
    secTitle:    { fontSize: 15, fontWeight: '700', color: TXT_PRI, letterSpacing: -0.3 },
    secAction:   { fontSize: 13, fontWeight: '600', color: TEAL },

    // Greeting card
    greetCard: {
        marginHorizontal: 16, marginTop: 16,
        borderRadius: 22, padding: 22, backgroundColor: TEAL_DK, overflow: 'hidden',
        shadowColor: TEAL_DK, shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.38, shadowRadius: 18, elevation: 10,
    },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: WHITE },
    greetRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    greetEmoji: { fontSize: 15 },
    greetSub:   { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.68)', letterSpacing: 0.1 },
    greetName:  { fontSize: 28, fontWeight: '700', color: WHITE, marginTop: 3, letterSpacing: -0.6 },

    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    pill: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    },
    pillUrgent: { backgroundColor: AMBER, borderColor: 'transparent' },
    pillText:   { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.94)' },

    progWrap: { marginTop: 18 },
    progTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, overflow: 'hidden' },
    progBar:   { height: 6, backgroundColor: WHITE, borderRadius: 999 },
    progLabels:{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    progLabel: { fontSize: 11, color: 'rgba(255,255,255,0.52)' },
    progPct:   { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.82)' },

    // Quick actions
    qaScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 2 },
    qaCard: {
        alignItems: 'center', width: 86,
        backgroundColor: WHITE, borderRadius: 18,
        paddingVertical: 16, paddingHorizontal: 12,
        borderWidth: 1, borderColor: BORDER,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    },
    qaIconBox: {
        width: 50, height: 50, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center', marginBottom: 9,
    },
    qaLabel: { fontSize: 12, fontWeight: '700', color: TXT_PRI, textAlign: 'center', letterSpacing: -0.1 },

    // Card
    card: {
        marginHorizontal: 16, backgroundColor: WHITE,
        borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
    },

    // Item row
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },

    // Checkbox
    checkbox: {
        width: 22, height: 22, borderRadius: 7,
        borderWidth: 2, borderColor: BORDER,
        alignItems: 'center', justifyContent: 'center',
    },
    checkboxDone: { backgroundColor: TEAL, borderColor: TEAL },

    // Item
    itemName: { fontSize: 14, fontWeight: '500', color: TXT_PRI },
    itemDone: { textDecorationLine: 'line-through', color: TXT_FAINT },
    itemMeta: { fontSize: 12, color: TXT_FAINT },
    itemRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    urgentBadge: {
        backgroundColor: '#FEF3C7', borderRadius: 8,
        paddingHorizontal: 7, paddingVertical: 2,
    },
    urgentBadgeText: { fontSize: 12 },
    delBtn: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: BG, alignItems: 'center', justifyContent: 'center',
    },

    // Urgent bar
    urgentBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 10 },
    urgentDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER },
    urgentBarText: { fontSize: 12, fontWeight: '500', color: '#B45309' },

    // See all
    seeAllBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        marginHorizontal: 16, marginTop: 10,
        paddingVertical: 12, backgroundColor: WHITE,
        borderRadius: 14, borderWidth: 1, borderColor: BORDER,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
    },
    seeAllText: { fontSize: 13, fontWeight: '600', color: TEAL },

    // Empty state
    emptyCard: {
        marginHorizontal: 16, backgroundColor: WHITE,
        borderRadius: 18, borderWidth: 1, borderColor: BORDER,
        paddingVertical: 36, alignItems: 'center', gap: 6,
    },
    emptyIcon:  { fontSize: 38, marginBottom: 4 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: TXT_PRI },
    emptyBody:  { fontSize: 13, color: TXT_MUT, textAlign: 'center', paddingHorizontal: 24 },

    // Low stock
    lowDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: AMBER },
    lowName: { flex: 1, fontSize: 14, fontWeight: '500', color: TXT_PRI },
    lowBy:   { fontSize: 12, color: TXT_FAINT },

    // Members
    membersScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 2 },
    memberCard: {
        alignItems: 'center', width: 82,
        backgroundColor: WHITE, borderRadius: 18,
        paddingVertical: 16, paddingHorizontal: 10,
        borderWidth: 1, borderColor: BORDER,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04, shadowRadius: 6, elevation: 1, gap: 6,
    },
    memberAvatar: {
        width: 44, height: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center',
    },
    memberInitials: { fontSize: 15, fontWeight: '800' },
    memberName:     { fontSize: 12, fontWeight: '600', color: TXT_PRI, textAlign: 'center' },
    memberRolePill: {
        backgroundColor: TEAL_LT, borderRadius: 999,
        paddingHorizontal: 8, paddingVertical: 2,
    },
    memberRoleAdmin: { backgroundColor: '#FEF3C7' },
    memberRoleText:  { fontSize: 10, fontWeight: '600', color: TEAL, textTransform: 'capitalize' },
    memberRoleAdminText: { color: '#B45309' },
    addMemberCard: {
        alignItems: 'center', width: 82,
        backgroundColor: BG, borderRadius: 18,
        paddingVertical: 16, paddingHorizontal: 10,
        borderWidth: 1.5, borderColor: BORDER,
        borderStyle: 'dashed', gap: 6,
    },
    addMemberIcon: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: TEAL_LT, alignItems: 'center', justifyContent: 'center',
    },
    addMemberLabel: { fontSize: 12, fontWeight: '600', color: TEAL },

    // Weekly report
    reportCard: {
        marginHorizontal: 16, backgroundColor: WHITE,
        borderRadius: 18, borderWidth: 1, borderColor: BORDER,
        padding: 16, gap: 14,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
    },
    reportTop:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
    reportIconBox: {
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: TEAL_LT, alignItems: 'center', justifyContent: 'center',
    },
    reportTitle: { fontSize: 14, fontWeight: '600', color: TXT_PRI },
    reportSub:   { fontSize: 12, color: TXT_MUT, marginTop: 2 },
    reportBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: TEAL, borderRadius: 14,
        paddingVertical: 14,
    },
    reportBtnText: { fontSize: 15, fontWeight: '700', color: WHITE },
});
