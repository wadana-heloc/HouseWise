import { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StatusBar,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';

interface FormState {
    displayName: string;
    email: string;
    password: string;
}

interface FieldError {
    displayName?: string;
    email?: string;
    password?: string;
}

interface PasswordRules {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
}

function checkPasswordRules(password: string): PasswordRules {
    return {
        minLength: password.length >= 8,
        hasUppercase: /[A-Z]/.test(password),
        hasLowercase: /[a-z]/.test(password),
        hasNumber: /[0-9]/.test(password),
        hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };
}

function isPasswordStrong(password: string): boolean {
    const rules = checkPasswordRules(password);
    return Object.values(rules).every(Boolean);
}

function validate(form: FormState): FieldError {
    const errors: FieldError = {};
    if (!form.displayName.trim()) errors.displayName = 'Name is required.';
    if (!form.email.trim()) {
        errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        errors.email = 'Enter a valid email address.';
    }
    if (!form.password) {
        errors.password = 'Password is required.';
    } else if (!isPasswordStrong(form.password)) {
        errors.password = 'Password does not meet the requirements below.';
    }
    return errors;
}

export default function AddMemberScreen() {
    const router = useRouter();
    const [form, setForm] = useState<FormState>({ displayName: '', email: '', password: '' });
    const [errors, setErrors] = useState<FieldError>({});
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    function setField(key: keyof FormState, value: string) {
        setForm((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    }

    async function handleSubmit() {
        const fieldErrors = validate(form);
        if (Object.keys(fieldErrors).length > 0) {
            setErrors(fieldErrors);
            return;
        }

        setLoading(true);
        try {
            await api.post('/household/members', {
                email: form.email.trim().toLowerCase(),
                password: form.password,
                display_name: form.displayName.trim(),
            });

            Alert.alert(
                'Member added',
                `${form.displayName.trim()} can now log in with the credentials you set.`,
                [{ text: 'Done', onPress: () => router.back() }],
            );
        } catch (err: any) {
            const status = err?.response?.status;
            if (status === 409) {
                setErrors({ email: 'This email is already registered.' });
            } else if (status === 403) {
                Alert.alert('Not allowed', 'Only admins can add family members.');
            } else if (status === 422) {
                Alert.alert('Invalid data', err?.response?.data?.detail ?? 'Check the form and try again.');
            } else {
                Alert.alert('Error', 'Something went wrong. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <SafeAreaView className="flex-1 bg-bg-primary">
            <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

            {/* Header */}
            <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
                <TouchableOpacity
                    onPress={() => router.back()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="arrow-back" size={22} color="#0D2D1F" />
                </TouchableOpacity>
                <Text className="text-[17px] font-medium text-text-primary">Add family member</Text>
            </View>

            <KeyboardAvoidingView
                className="flex-1"
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 40 }}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Info banner */}
                    <View className="mx-5 mt-5 bg-teal-50 border border-teal-600/20 rounded-2xl p-4 flex-row gap-3">
                        <Ionicons name="information-circle-outline" size={20} color="#1D9E75" />
                        <Text className="flex-1 text-[13px] text-teal-800 leading-5">
                            The account is created immediately. Share the email and password with the family member — they can log in right away.
                        </Text>
                    </View>

                    {/* Form card */}
                    <View className="mx-5 mt-5 bg-white border border-border rounded-2xl p-5 gap-4">

                        {/* Display name */}
                        <View>
                            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2">
                                Display name
                            </Text>
                            <TextInput
                                className={`bg-bg-primary border rounded-xl px-4 py-3.5 text-[14px] text-text-primary ${
                                    errors.displayName ? 'border-red-400' : 'border-border'
                                }`}
                                placeholder="e.g. Deema"
                                placeholderTextColor="#A8C4B8"
                                value={form.displayName}
                                onChangeText={(v) => setField('displayName', v)}
                                autoCapitalize="words"
                                returnKeyType="next"
                            />
                            {errors.displayName && (
                                <Text className="text-[12px] text-red-500 mt-1.5">{errors.displayName}</Text>
                            )}
                        </View>

                        {/* Email */}
                        <View>
                            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2">
                                Email
                            </Text>
                            <TextInput
                                className={`bg-bg-primary border rounded-xl px-4 py-3.5 text-[14px] text-text-primary ${
                                    errors.email ? 'border-red-400' : 'border-border'
                                }`}
                                placeholder="e.g. deema@gmail.com"
                                placeholderTextColor="#A8C4B8"
                                value={form.email}
                                onChangeText={(v) => setField('email', v)}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="next"
                            />
                            {errors.email && (
                                <Text className="text-[12px] text-red-500 mt-1.5">{errors.email}</Text>
                            )}
                        </View>

                        {/* Password */}
                        <View>
                            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2">
                                Password
                            </Text>
                            <View className={`flex-row items-center bg-bg-primary border rounded-xl px-4 ${
                                errors.password ? 'border-red-400' : 'border-border'
                            }`}>
                                <TextInput
                                    className="flex-1 py-3.5 text-[14px] text-text-primary"
                                    placeholder="Min. 8 chars, upper, lower, number, symbol"
                                    placeholderTextColor="#A8C4B8"
                                    value={form.password}
                                    onChangeText={(v) => setField('password', v)}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    returnKeyType="done"
                                    onSubmitEditing={handleSubmit}
                                />
                                <TouchableOpacity
                                    onPress={() => setShowPassword((p) => !p)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={18}
                                        color="#A8C4B8"
                                    />
                                </TouchableOpacity>
                            </View>
                            {errors.password && (
                                <Text className="text-[12px] text-red-500 mt-1.5">{errors.password}</Text>
                            )}
                            {form.password.length > 0 && (() => {
                                const rules = checkPasswordRules(form.password);
                                const items: { key: keyof PasswordRules; label: string }[] = [
                                    { key: 'minLength',    label: 'At least 8 characters' },
                                    { key: 'hasUppercase', label: 'One uppercase letter (A–Z)' },
                                    { key: 'hasLowercase', label: 'One lowercase letter (a–z)' },
                                    { key: 'hasNumber',    label: 'One number (0–9)' },
                                    { key: 'hasSpecial',   label: 'One special character (!@#…)' },
                                ];
                                return (
                                    <View className="mt-3 gap-1.5">
                                        {items.map(({ key, label }) => (
                                            <View key={key} className="flex-row items-center gap-2">
                                                <Ionicons
                                                    name={rules[key] ? 'checkmark-circle' : 'close-circle-outline'}
                                                    size={14}
                                                    color={rules[key] ? '#1D9E75' : '#EF4444'}
                                                />
                                                <Text className={`text-[12px] ${rules[key] ? 'text-teal-700' : 'text-red-400'}`}>
                                                    {label}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                );
                            })()}
                        </View>
                    </View>

                    {/* Submit button */}
                    <TouchableOpacity
                        className={`mx-5 mt-5 rounded-xl py-4 flex-row items-center justify-center gap-2 ${
                            loading ? 'bg-teal-400' : 'bg-teal-600'
                        }`}
                        onPress={handleSubmit}
                        activeOpacity={0.85}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Ionicons name="person-add-outline" size={20} color="#fff" />
                        )}
                        <Text className="text-[16px] font-semibold text-white">
                            {loading ? 'Creating account…' : 'Add member'}
                        </Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}
