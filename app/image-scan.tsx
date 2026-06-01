import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useItemStore } from '../store/itemStore';
import { scanImage } from '../services/items';

const UNITS = ['units', 'kg', 'g', 'L', 'ml', 'packs', 'loaves', 'bottles', 'cans', 'bags'];
const CATEGORIES = ['Dairy', 'Meat', 'Grains', 'Bakery', 'Pantry', 'Produce', 'Frozen', 'Drinks', 'Cleaning', 'Other'];
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type Stage = 'capture' | 'found' | 'not-found';
type CaptureMode = 'camera' | 'gallery';

interface ScannedProduct {
  name: string | null;
  brand: string | null;
  size: string | null;
}

function resolveMediaType(mimeType?: string | null): string {
  if (mimeType && ACCEPTED_MIME_TYPES.has(mimeType)) return mimeType;
  return 'image/jpeg';
}

async function uriToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function ImageScanScreen() {
  const router = useRouter();
  const addItem = useItemStore((s) => s.addItem);

  const [stage, setStage] = useState<Stage>('capture');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('camera');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [product, setProduct] = useState<ScannedProduct | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('units');
  const [category, setCategory] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  async function processImage(base64: string, mimeType?: string | null) {
    setLoading(true);
    try {
      const result = await scanImage(base64, resolveMediaType(mimeType));
      if (result.reason !== null) {
        setFailReason(result.reason);
        setStage('not-found');
      } else {
        setProduct({ name: result.name, brand: result.brand, size: result.size });
        setName(result.name ?? '');
        setStage('found');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 503) {
        Alert.alert('Service unavailable', 'Image scanning is not available right now.');
      } else if (status === 422) {
        Alert.alert('Invalid image', 'The image is too large or in an unsupported format.');
      } else {
        Alert.alert('Error', 'Could not scan image. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleTakePhoto() {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.75 });
      if (!photo?.base64) {
        Alert.alert('Error', 'Could not capture photo. Try again.');
        return;
      }
      await processImage(photo.base64, 'image/jpeg');
    } catch {
      Alert.alert('Error', 'Could not capture photo. Try again.');
    }
  }

  async function handlePickGallery() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        base64: true,
        quality: 0.75,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // asset.base64 is null for cloud-synced photos on Android that aren't
      // fully local yet — fall back to reading the URI directly.
      const base64 = asset.base64 ?? await uriToBase64(asset.uri);
      await processImage(base64, asset.mimeType);
    } catch {
      Alert.alert('Error', 'Could not open gallery. Try again.');
    }
  }

  function resetCapture() {
    setStage('capture');
    setProduct(null);
    setFailReason(null);
    setName('');
    setQty('1');
    setUnit('units');
    setCategory('');
    setUrgent(false);
    setNotes('');
  }

  async function handleAdd() {
    if (!name.trim()) return;
    const quantity = Math.max(0.5, parseFloat(qty) || 0.5);
    setSubmitting(true);
    try {
      await addItem({
        name: name.trim(),
        category: category || 'other',
        quantity,
        unit,
        urgent,
        notes: notes.trim() || undefined,
      });
      Alert.alert('Item added', `"${name.trim()}" has been added to the list.`, [
        { text: 'Scan another', onPress: resetCapture },
        { text: 'Go to list', onPress: () => router.push('/(tabs)/list') },
      ]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Failed to add item. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (captureMode === 'camera' && !permission) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator size="large" color="#1D9E75" />
      </SafeAreaView>
    );
  }

  if (captureMode === 'camera' && permission && !permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary">
        <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />
        <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="close" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Scan product photo</Text>
        </View>
        <View className="flex-1 items-center justify-center px-8 gap-5">
          <Ionicons name="camera-outline" size={64} color="#7AAA96" />
          <Text className="text-[16px] font-medium text-text-primary text-center">Camera permission required</Text>
          <Text className="text-[13px] text-text-muted text-center">
            HouseWise needs camera access to photograph products.
          </Text>
          <TouchableOpacity
            className="bg-teal-600 rounded-xl py-3.5 px-8 items-center"
            onPress={requestPermission}
          >
            <Text className="text-[15px] font-semibold text-white">Grant permission</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCaptureMode('gallery')}>
            <Text className="text-[13px] text-text-muted">Pick from gallery instead</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="text-[20px] font-medium text-text-primary">Scan product photo</Text>
      </View>

      {/* Barcode / Photo mode tabs */}
      <View className="flex-row mx-5 mt-4 bg-white border border-border rounded-xl overflow-hidden">
        <TouchableOpacity
          className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5"
          onPress={() => router.replace('/barcode-confirm')}
        >
          <Ionicons name="barcode-outline" size={16} color="#7AAA96" />
          <Text className="text-[13px] font-medium text-text-muted">Barcode</Text>
        </TouchableOpacity>
        <View className="w-px bg-border" />
        <View className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5 bg-teal-600">
          <Ionicons name="camera-outline" size={16} color="#fff" />
          <Text className="text-[13px] font-semibold text-white">Photo</Text>
        </View>
      </View>

      {/* Camera / preview area */}
      <View
        className="mx-5 mt-3 bg-white border border-border rounded-2xl overflow-hidden"
        style={{ height: 220 }}
      >
        {stage === 'capture' && captureMode === 'camera' && !loading && (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
            <View className="flex-1 items-center justify-end pb-4">
              <TouchableOpacity
                className="w-16 h-16 rounded-full bg-white items-center justify-center"
                style={{ borderWidth: 4, borderColor: '#2DD4BF' }}
                onPress={handleTakePhoto}
                activeOpacity={0.85}
              >
                <View className="w-11 h-11 rounded-full bg-teal-600" />
              </TouchableOpacity>
            </View>
          </CameraView>
        )}

        {stage === 'capture' && captureMode === 'gallery' && !loading && (
          <TouchableOpacity
            className="flex-1 items-center justify-center gap-3"
            onPress={handlePickGallery}
            activeOpacity={0.8}
          >
            <View className="w-16 h-16 rounded-2xl bg-teal-50 items-center justify-center">
              <Ionicons name="images-outline" size={32} color="#1D9E75" />
            </View>
            <Text className="text-[14px] font-medium text-teal-600">Choose from gallery</Text>
            <Text className="text-[12px] text-text-muted">Tap to browse your photos</Text>
          </TouchableOpacity>
        )}

        {loading && (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Identifying product…</Text>
          </View>
        )}

        {stage === 'found' && product && (
          <View className="flex-1 px-5 py-4 justify-center gap-2">
            <View className="flex-row items-center gap-3">
              <View className="w-12 h-12 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="checkmark-circle" size={24} color="#1D9E75" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[14px] font-medium text-text-primary" numberOfLines={2}>
                  {product.name ?? name}
                </Text>
                <View className="flex-row items-center gap-2 mt-0.5 flex-wrap">
                  {product.brand ? <Text className="text-[11px] text-text-muted">{product.brand}</Text> : null}
                  {product.brand && product.size ? <Text className="text-[11px] text-text-faint">·</Text> : null}
                  {product.size ? <Text className="text-[11px] text-text-muted">{product.size}</Text> : null}
                </View>
              </View>
              <TouchableOpacity onPress={resetCapture} className="p-1">
                <Ionicons name="refresh-outline" size={18} color="#7AAA96" />
              </TouchableOpacity>
            </View>
            <View className="border-t border-border pt-2">
              <Text className="text-[10px] text-text-faint">Identified via photo · Review and adjust below</Text>
            </View>
          </View>
        )}

        {stage === 'not-found' && (
          <View className="flex-1 items-center justify-center gap-3 px-5">
            <Ionicons name="alert-circle-outline" size={36} color="#D6EDE5" />
            <Text className="text-[13px] text-text-muted text-center">
              {failReason ?? 'Could not identify this product. Try a clearer photo.'}
            </Text>
          </View>
        )}
      </View>

      {/* Camera / Gallery sub-toggle (only during capture) */}
      {stage === 'capture' && !loading && (
        <View className="flex-row mx-5 mt-3 gap-2">
          <TouchableOpacity
            className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${captureMode === 'camera' ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
            onPress={() => setCaptureMode('camera')}
          >
            <Ionicons name="camera-outline" size={16} color={captureMode === 'camera' ? '#fff' : '#7AAA96'} />
            <Text className={`text-[13px] font-medium ${captureMode === 'camera' ? 'text-white' : 'text-text-muted'}`}>
              Camera
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${captureMode === 'gallery' ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
            onPress={() => setCaptureMode('gallery')}
          >
            <Ionicons name="images-outline" size={16} color={captureMode === 'gallery' ? '#fff' : '#7AAA96'} />
            <Text className={`text-[13px] font-medium ${captureMode === 'gallery' ? 'text-white' : 'text-text-muted'}`}>
              Gallery
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Form — shown after successful identification */}
      {stage === 'found' && product ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          {/* Name */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Item name</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[15px] text-text-primary"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#A8C4B8"
            />
          </View>

          {/* Qty + Unit */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Quantity & unit</Text>
            <View className="flex-row gap-3">
              <View className="flex-row items-center bg-white border border-border rounded-xl overflow-hidden" style={{ width: 120 }}>
                <TouchableOpacity
                  className="px-3 py-3.5 items-center justify-center"
                  onPress={() => setQty((v) => String(Math.max(0.5, Math.round((Number(v) - 0.5) * 10) / 10)))}
                >
                  <Ionicons name="remove" size={18} color="#7AAA96" />
                </TouchableOpacity>
                <TextInput
                  className="flex-1 text-center text-[16px] font-medium text-text-primary"
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  className="px-3 py-3.5 items-center justify-center"
                  onPress={() => setQty((v) => String(Math.round((Number(v) + 0.5) * 10) / 10))}
                >
                  <Ionicons name="add" size={18} color="#1D9E75" />
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, alignItems: 'center' }}
              >
                {UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    className={`px-3 py-2 rounded-xl border ${unit === u ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => setUnit(u)}
                  >
                    <Text className={`text-[13px] font-medium ${unit === u ? 'text-white' : 'text-text-muted'}`}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Category */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Category</Text>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const key = c.toLowerCase();
                return (
                  <TouchableOpacity
                    key={c}
                    className={`px-3 py-2 rounded-xl border ${category === key ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => setCategory(key)}
                  >
                    <Text className={`text-[13px] font-medium ${category === key ? 'text-white' : 'text-text-muted'}`}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Urgent toggle */}
          <TouchableOpacity
            className={`flex-row items-center justify-between bg-white border rounded-xl px-4 py-4 ${urgent ? 'border-amber-400' : 'border-border'}`}
            onPress={() => setUrgent((v) => !v)}
            activeOpacity={0.8}
          >
            <View className="flex-row items-center gap-3">
              <View className={`w-9 h-9 rounded-xl items-center justify-center ${urgent ? 'bg-amber-100' : 'bg-teal-50'}`}>
                <Ionicons name="flash-outline" size={20} color={urgent ? '#92400E' : '#7AAA96'} />
              </View>
              <View>
                <Text className="text-[14px] font-medium text-text-primary">Mark as urgent</Text>
                <Text className="text-[12px] text-text-faint mt-0.5">Buyer will be notified immediately</Text>
              </View>
            </View>
            <View className={`w-12 h-6 rounded-full items-center justify-center ${urgent ? 'bg-amber-400' : 'bg-teal-50'}`}>
              <View className={`w-5 h-5 rounded-full bg-white ${urgent ? 'translate-x-3' : '-translate-x-1.5'}`} />
            </View>
          </TouchableOpacity>

          {/* Notes */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Notes (optional)</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
              placeholder="e.g. Low-fat version only"
              placeholderTextColor="#A8C4B8"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Add button */}
          <TouchableOpacity
            className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
            onPress={handleAdd}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="add-circle-outline" size={20} color="#fff" />}
            <Text className="text-[16px] font-semibold text-white">
              {submitting ? 'Adding…' : 'Add to list'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Text className="text-[13px] text-text-muted">Type item name instead</Text>
          </TouchableOpacity>

          <View style={{ height: 16 }} />
        </ScrollView>
      ) : (
        <View className="px-5 mt-4 gap-3">
          {stage === 'not-found' && (
            <TouchableOpacity
              className="bg-teal-600 rounded-xl py-4 items-center flex-row justify-center gap-2"
              onPress={resetCapture}
              activeOpacity={0.85}
            >
              <Ionicons name="camera-outline" size={20} color="#fff" />
              <Text className="text-[16px] font-semibold text-white">Try again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="items-center py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Text className="text-[13px] text-text-muted">Type item name instead</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
