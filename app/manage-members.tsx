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
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useMemberStore } from '../store/memberStore';

function getInitials(name: string): string {
    return name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');
}

export default function ManageMembersScreen() {
    const router = useRouter();
    const { userId } = useAuthStore();
    const { members, loading, error, fetchMembers, deleteMember } = useMemberStore();

    useFocusEffect(
        useCallback(() => {
            fetchMembers();
        }, []),
    );

    function confirmDelete(id: string, name: string) {
        Alert.alert(
            'Remove member',
            `Remove "${name}" from the household? Their account will be permanently deleted and they will lose access immediately.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                        deleteMember(id).catch(() =>
                            Alert.alert('Error', 'Could not remove member. Try again.'),
                        ),
                },
            ],
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-bg-primary">
            <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

            {/* Header */}
            <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
                <TouchableOpacity onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={22} color="#3D6B55" />
                </TouchableOpacity>
                <View className="flex-1">
                    <Text className="text-[20px] font-medium text-text-primary">Household members</Text>
                </View>
                <TouchableOpacity
                    className="flex-row items-center gap-1.5 bg-teal-50 border border-teal-600/20 rounded-full px-3 py-1.5"
                    onPress={() => router.push('/add-member')}
                >
                    <Ionicons name="person-add-outline" size={14} color="#1D9E75" />
                    <Text className="text-[13px] font-medium text-teal-600">Add</Text>
                </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>

                {loading && (
                    <View className="bg-white border border-border rounded-xl py-10 items-center gap-2">
                        <ActivityIndicator size="small" color="#1D9E75" />
                        <Text className="text-[13px] text-text-muted">Loading members…</Text>
                    </View>
                )}

                {!loading && error && (
                    <View className="bg-white border border-border rounded-xl py-10 items-center gap-3">
                        <Ionicons name="alert-circle-outline" size={28} color="#D6EDE5" />
                        <Text className="text-[13px] text-text-muted">{error}</Text>
                        <TouchableOpacity
                            className="bg-teal-50 border border-teal-600/20 rounded-full px-4 py-2"
                            onPress={fetchMembers}
                        >
                            <Text className="text-[13px] font-medium text-teal-600">Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!loading && !error && members.length === 0 && (
                    <View className="bg-white border border-border rounded-xl py-10 items-center gap-2">
                        <Ionicons name="people-outline" size={28} color="#D6EDE5" />
                        <Text className="text-[13px] text-text-muted">No members found</Text>
                    </View>
                )}

                {!loading && !error && members.length > 0 && (
                    <View className="bg-white border border-border rounded-xl overflow-hidden">
                        {members.map((member, i) => {
                            const isSelf = member.id === userId;
                            const isAdmin = member.role === 'admin';
                            const canDelete = !isSelf && !isAdmin;
                            const initials = getInitials(member.display_name);

                            return (
                                <View
                                    key={member.id}
                                    className={`flex-row items-center px-4 py-3.5 gap-3 ${i < members.length - 1 ? 'border-b border-border' : ''}`}
                                >
                                    {/* Avatar */}
                                    <View className="w-10 h-10 rounded-full bg-teal-50 items-center justify-center">
                                        <Text className="text-[13px] font-medium text-teal-600">{initials}</Text>
                                    </View>

                                    {/* Info */}
                                    <View className="flex-1">
                                        <View className="flex-row items-center gap-2">
                                            <Text className="text-[14px] font-medium text-text-primary">
                                                {member.display_name}
                                            </Text>
                                            {isSelf && (
                                                <Text className="text-[11px] text-text-faint">(you)</Text>
                                            )}
                                        </View>
                                        <Text className="text-[12px] text-text-faint mt-0.5">{member.email}</Text>
                                    </View>

                                    {/* Role badge */}
                                    <View className={`rounded-full px-2.5 py-1 ${isAdmin ? 'bg-teal-600' : 'bg-teal-50 border border-teal-600/20'}`}>
                                        <Text className={`text-[11px] font-medium capitalize ${isAdmin ? 'text-white' : 'text-teal-600'}`}>
                                            {member.role}
                                        </Text>
                                    </View>

                                    {/* Delete button */}
                                    {canDelete ? (
                                        <TouchableOpacity
                                            className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
                                            onPress={() => confirmDelete(member.id, member.display_name)}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        >
                                            <Ionicons name="trash-outline" size={15} color="#EF4444" />
                                        </TouchableOpacity>
                                    ) : (
                                        <View className="w-8" />
                                    )}
                                </View>
                            );
                        })}
                    </View>
                )}

                <Text className="text-[12px] text-text-faint text-center mt-4 px-4">
                    Removing a member permanently deletes their account and access.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}
