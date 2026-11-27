import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { hapticLight, hapticMedium, hapticSelection } from '../src/ui/haptics';
import Svg, { Path } from 'react-native-svg';
import { DoopIcon } from '../src/ui/components/DoopIcons';
import type { UndoAction } from '../src/app/controller';
import { useAction, useAIStatus, useAppRuntime, usePreferences } from '../src/app/AppRuntimeContext';
import { defaultQuantity, localDate, MEALS, mealsForDay, parseRouteDate } from '../src/app/controller';
import { type BarcodeResolution, type ParsedNutritionLabel } from '../src/barcode';
import {
  createNativeBarcodeScannerPort,
  NativeBarcodeScannerView,
  requestNativeCameraPermission,
  type CapturedNativePhoto,
} from '../modules/oct-barcode-scanner';
import { calculateNutrition, generateId, type FoodRecord, type Quantity } from '../src/domain';
import { InlineKeypad } from '../src/ui/components/doop';
import {
  BarcodeFoundCard,
  BarcodeNotFoundCard,
  CustomFoodFormCard,
  parseCustomFoodNutrients,
  parseNonNegativeNumber,
  pickMealImage,
  SegmentedSwitch,
  setPendingMealPhoto,
  type CustomFoodFormValues,
  type PickedMealImage,
} from '../src/ui/components/capture';
import { Button, energy, energyValue, ErrorMessage, goBackOrReplace, Heading, Input, Muted, ui } from '../src/ui/components/primitives';
import { colors, fontFace, radius } from '../src/ui/tokens';

const tierLabels = { personal: 'Yours', pack: 'Food pack', off_cache: 'Open Food Facts · cached', off_live: 'Open Food Facts · live' };
const SEG_WIDTH = 224;
const SEG_PAD = 3;
const SEG_THUMB_WIDTH = (SEG_WIDTH - SEG_PAD * 2) / 2;

function portionChoices(food: FoodRecord) {
  const quantities: Quantity[] = [defaultQuantity(food), { amount: 100, unit: food.basis === 'per_100ml' ? 'ml' : 'g' }, ...food.units.map(unit => ({ amount: 1, unit: unit.label }))];
  const seen = new Set<string>();
  return quantities.flatMap(quantity => {
    const key = `${quantity.amount}:${quantity.unit}`;
    if (seen.has(key)) return [];
    seen.add(key);
    try { return [{ quantity, nutrients: calculateNutrition(food, quantity) }]; } catch { return []; }
  });
}

export default function Barcode() {
  const params = useLocalSearchParams<{ meal?: string; date?: string; mode?: string; returnTo?: string }>();
  const { controller } = useAppRuntime();
  const preferences = usePreferences();
  const ai = useAIStatus();
  const reducedMotion = useReducedMotion();
  const meal = params.meal?.trim() || preferences.value?.mealSections[0] || 'Lunch';
  const pickerMeals = mealsForDay(preferences.value?.mealSections ?? [...MEALS], [], [meal]);
  const targetDate = parseRouteDate(params.date);
  const unit = preferences.value?.energyUnit ?? 'kcal';
  const action = useAction();

  const initialCameraMode: 'photo' | 'barcode' = params.mode === 'photo' ? 'photo' : 'barcode';
  const [cameraMode, setCameraMode] = useState<'photo' | 'barcode'>(initialCameraMode);
  const [labelMode, setLabelMode] = useState(false);
  const [code, setCode] = useState('');
  const [symbology, setSymbology] = useState('');
  const [result, setResult] = useState<BarcodeResolution | null>(null);
  const [selected, setSelected] = useState(0);
  const [labelText, setLabelText] = useState('');
  const [custom, setCustom] = useState<{ id: string; barcode: { rawCode: string; symbology?: string } | null; label: ParsedNutritionLabel | null; energyUnit: 'kcal' | 'kJ'; name?: string | null; brand?: string | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<{ meal: string; undo: UndoAction | null; energyText?: string } | null>(null);
  const [typing, setTyping] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [appliedCustomPortion, setAppliedCustomPortion] = useState<Quantity | null>(null);
  const [portionOpen, setPortionOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureToken, setCaptureToken] = useState(0);
  const lastCapturedTokenRef = useRef(0);

  const scannerPort = useMemo(() => createNativeBarcodeScannerPort(), []);
  const scanner = scannerPort.capability;

  // Reanimated UI-thread animations for Photo ↔ Barcode transitions, shutter, and scan line.
  const modeProgress = useSharedValue(initialCameraMode === 'barcode' ? 1 : 0);
  const shutterScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const scanLine = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      modeProgress.set(cameraMode === 'barcode' ? 1 : 0);
    } else {
      modeProgress.set(withSpring(cameraMode === 'barcode' ? 1 : 0, { damping: 20, stiffness: 280, mass: 0.85 }));
    }
  }, [cameraMode, modeProgress, reducedMotion]);

  useEffect(() => {
    if (cameraMode === 'barcode' && !reducedMotion) {
      scanLine.set(0);
      scanLine.set(withRepeat(withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.sin) }), -1, true));
    } else {
      scanLine.set(0.5);
    }
  }, [cameraMode, reducedMotion, scanLine]);

  useEffect(() => {
    if (!scanner.liveCamera.available) return;
    let active = true;
    void requestNativeCameraPermission()
      .then(granted => {
        if (active) {
          setCameraOpen(granted);
          if (!granted) setNotice('Camera access is off. Pick a photo from library or type a barcode.');
        }
      })
      .catch(error => {
        if (active) setNotice(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
  }, [scanner.liveCamera.available]);

  const finishWithMealPhoto = useCallback((photo: PickedMealImage) => {
    setTorch(false);
    const todayIso = localDate();
    const isHistorical = Boolean(targetDate && targetDate !== todayIso);
    const returnTab: 'today' | 'history' = params.returnTo === 'history' || (params.returnTo === 'library' && isHistorical) ? 'history' : 'today';
    setPendingMealPhoto({ meal, photo, ...(targetDate ? { date: targetDate } : {}), returnTab });
    if (params.returnTo === 'library' || !router.canGoBack()) {
      if (returnTab === 'history') {
        router.replace(targetDate ? { pathname: '/(tabs)/history', params: { date: targetDate } } : '/(tabs)/history');
      } else {
        router.replace('/(tabs)');
      }
    } else {
      router.back();
    }
  }, [meal, params.returnTo, targetDate]);

  const switchCameraMode = (next: 'photo' | 'barcode') => {
    if (next === cameraMode) return;
    hapticSelection();
    setCameraMode(next);
    setNotice('');
    if (next === 'photo') {
      setTyping(false);
      setLabelMode(false);
    }
  };

  useEffect(() => {
    if (!capturing) return;
    const timer = setTimeout(() => {
      setCapturing(false);
      setNotice('Camera did not respond in time. Try again or choose a photo from your library.');
    }, 4500);
    return () => clearTimeout(timer);
  }, [capturing]);

  const openCamera = () => void action.run(async () => {
    setNotice('');
    const granted = await requestNativeCameraPermission();
    if (!granted) {
      setNotice('Camera permission was not granted. Enable camera access in OS Settings or choose a photo.');
      return;
    }
    setCameraOpen(true);
  });

  const triggerShutter = () => {
    if (capturing || action.busy) return;
    setNotice('');
    hapticMedium();
    if (!reducedMotion) {
      flashOpacity.set(withSequence(withTiming(0.55, { duration: 55 }), withTiming(0, { duration: 190, easing: Easing.out(Easing.quad) })));
    }
    if (cameraOpen && scanner.liveCamera.available) {
      setCapturing(true);
      setCaptureToken(current => current + 1);
      return;
    }
    // Fallback for web / environments without a live CameraX/AVFoundation camera.
    void action.run(async () => {
      const picked = await pickMealImage('camera');
      if (picked) finishWithMealPhoto(picked);
    });
  };

  const handlePhotoCaptured = (photo: CapturedNativePhoto) => {
    if (photo.token && photo.token === lastCapturedTokenRef.current) return;
    lastCapturedTokenRef.current = photo.token;
    setCapturing(false);
    finishWithMealPhoto({
      uri: photo.uri,
      imageDataUrl: photo.imageDataUrl,
      width: photo.width,
      height: photo.height,
    });
  };

  const pickGalleryPhoto = () => void action.run(async () => {
    setNotice('');
    const picked = await pickMealImage('library');
    if (!picked) return;
    if (cameraMode === 'photo') {
      finishWithMealPhoto(picked);
      return;
    }
    const decoded = await scannerPort.decode({ kind: 'photo', uri: picked.uri });
    if (!decoded) {
      setNotice('No barcode was detected in that photo. Try a sharper photo or type the digits below.');
      return;
    }
    setCode(decoded.rawCode);
    setSymbology(decoded.symbology);
    const resolved = await controller.resolveBarcode(decoded.rawCode, decoded.rawCode.length === 8 ? decoded.symbology : undefined);
    setResult(resolved); setSelected(0); setAppliedCustomPortion(null); setCustomAmount(''); setPortionOpen(false); setReceipt(null); setTyping(false);
  });

  const changeCode = (value: string) => { setCode(value.replace(/\D/g, '').slice(0, 14)); setSymbology(''); setResult(null); setCustom(null); setAppliedCustomPortion(null); setCustomAmount(''); setPortionOpen(false); setNotice(''); };
  const resolve = (rawCode = code, format = symbology) => void action.run(async () => {
    setCustom(null); setNotice(''); setResult(null); setAppliedCustomPortion(null); setCustomAmount(''); setPortionOpen(false);
    const resolved = await controller.resolveBarcode(rawCode, rawCode.length === 8 ? format : undefined);
    setResult(resolved); setSelected(0); setReceipt(null); setTyping(false);
  });

  const found = result?.status === 'found' ? result : null;
  const showingOutcome = Boolean(found || result?.status === 'not_found' || custom);
  const portions = useMemo(() => {
    if (!found) return [];
    const base = portionChoices(found.food);
    if (!appliedCustomPortion) return base;
    try {
      const customItem = { quantity: appliedCustomPortion, nutrients: calculateNutrition(found.food, appliedCustomPortion) };
      const filtered = base.filter(item => !(item.quantity.amount === appliedCustomPortion.amount && item.quantity.unit === appliedCustomPortion.unit));
      return [customItem, ...filtered];
    } catch {
      return base;
    }
  }, [appliedCustomPortion, found]);
  const customPortionCandidate = useMemo(() => {
    if (!found || !customAmount.trim()) return null;
    const parsedAmount = Number(customAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
    const quantity: Quantity = { amount: parsedAmount, unit: found.food.basis === 'per_100ml' ? 'ml' : 'g' };
    try {
      return { quantity, nutrients: calculateNutrition(found.food, quantity) };
    } catch {
      return null;
    }
  }, [customAmount, found]);
  const parsed = custom?.label;
  const formUnit = custom?.energyUnit ?? unit;
  const field = (value: number | null | undefined) => value == null ? '' : String(value);
  const initialValues: Partial<CustomFoodFormValues> = parsed ? {
    name: custom?.name ?? '', brand: custom?.brand ?? '',
    ...(parsed.basis ? { basis: parsed.basis } : {}), servingAmount: field(parsed.basis === 'per_100ml' ? parsed.serving_ml : parsed.serving_g),
    kcal: field(energyValue(parsed.nutrients.kcal, formUnit)),
    proteinG: field(parsed.nutrients.protein_g), carbsG: field(parsed.nutrients.carbs_g), fatG: field(parsed.nutrients.fat_g),
    fiberG: field(parsed.nutrients.fiber_g), sugarG: field(parsed.nutrients.sugar_g),
  } : {};

  const captureLabel = (source: 'camera' | 'library') => void action.run(async () => {
    const picked = await pickMealImage(source);
    if (!picked) return;
    if (!ai.value || ai.value.mode === 'disconnected' || !ai.value.consentAccepted) {
      setNotice('Label photos need a connected AI account and your consent. Open ChatGPT settings, or paste the label text below to review it offline.');
      return;
    }
    const extracted = await controller.extractLabelFromImage(picked.imageDataUrl);
    const { name, brand, basis, serving_g, serving_ml, ...nutrients } = extracted;
    const label: ParsedNutritionLabel = {
      basis, serving_g, serving_ml,
      nutrients: { ...nutrients, calcium_mg: null, iron_mg: null, potassium_mg: null },
      warnings: ['Extracted from a photo with AI. Check the printed basis and every value before saving.',
        ...(['fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg'] as const).filter(key => nutrients[key] === null).map(key => `${key.replace(/_(g|mg)$/, '').replaceAll('_', ' ')} was not detected and remains unknown.`)],
    };
    setCustom({ id: generateId(), barcode: result?.status === 'not_found' ? { rawCode: code, ...(symbology ? { symbology } : {}) } : null, label, energyUnit: unit, name, brand });
    setNotice('Label photo ready for review. Nothing has been logged.');
  });

  const saveCustom = (values: CustomFoodFormValues, log: boolean, selectedMeal = meal) => void action.run(async () => {
    if (!custom) return;
    const servingInput = values.servingAmount.trim() ? parseNonNegativeNumber(values.servingAmount, 'serving size') : null;
    if (servingInput === 0) throw new Error('Serving size must be greater than zero');
    const isVolume = values.basis === 'per_100ml';
    const servingG = isVolume
      ? (custom.label?.basis === values.basis ? custom.label.serving_g : null)
      : (servingInput ?? (custom.label?.basis === values.basis ? custom.label.serving_g : null));
    const servingMl = isVolume
      ? (servingInput ?? (custom.label?.basis === values.basis ? custom.label.serving_ml : null))
      : (custom.label?.basis === values.basis ? custom.label.serving_ml : null);
    const parsedNutrients = parseCustomFoodNutrients(values, formUnit, true);
    const food = await controller.saveCustomFoodWithBarcode({
      id: custom.id, name: values.name.trim(), brand: values.brand.trim() || null, basis: values.basis,
      prep_state: 'unknown', provenance_kind: 'user', serving_g: servingG,
      serving_ml: servingMl,
      nutrients: {
        ...custom.label?.nutrients,
        ...parsedNutrients,
      },
    }, custom.barcode);
    if (log) {
      const baseQuantity = defaultQuantity(food);
      const quantity: Quantity = { ...baseQuantity, amount: baseQuantity.amount * (values.logMultiplier ?? 1) };
      const entry = await controller.confirm({ food, quantity, meal: selectedMeal, ...(targetDate ? { date: targetDate } : {}), idempotencyKey: `custom:${custom.id}` });
      setReceipt({ meal: selectedMeal, undo: controller.undoAction, energyText: energy(entry.nutrients.kcal, unit) });
      setNotice('');
      return;
    }
    setCustom(null); setResult(null); setNotice('Custom food saved to your library.');
  });

  const logFound = (selectedMeal: string) => void action.run(async () => {
    if (!found) return;
    const portion = portions[selected]; if (!portion) throw new Error('Choose a valid portion');
    await controller.confirm({ food: found.food, quantity: portion.quantity, meal: selectedMeal, ...(targetDate ? { date: targetDate } : {}), idempotencyKey: generateId() });
    setReceipt({ meal: selectedMeal, undo: controller.undoAction });
  });

  const undo = () => void action.run(async () => {
    await receipt?.undo?.run();
    if (controller.undoAction === receipt?.undo) controller.dismissUndo(); else controller.refresh();
    setReceipt(null);
  });

  const close = () => {
    if (custom) { setCustom(null); setReceipt(null); return; }
    if (showingOutcome || typing || labelMode) { setResult(null); setAppliedCustomPortion(null); setCustomAmount(''); setPortionOpen(false); setReceipt(null); setTyping(false); setLabelMode(false); setNotice(''); return; }
    setTorch(false);
    goBackOrReplace('/(tabs)');
  };

  // Animated styles for smooth Photo ↔ Barcode switching.
  const segThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(modeProgress.value, [0, 1], [0, SEG_THUMB_WIDTH], Extrapolation.CLAMP) }],
    backgroundColor: interpolateColor(modeProgress.value, [0, 1], [colors.ink, colors.accent]),
  }));

  const reticleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(modeProgress.value, [0.25, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(modeProgress.value, [0, 1], [0.88, 1], Extrapolation.CLAMP) }],
  }));

  const scanBeamStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(scanLine.value, [0, 1], [18, 134], Extrapolation.CLAMP) }],
    opacity: interpolate(modeProgress.value, [0.5, 1], [0, 0.55], Extrapolation.CLAMP),
  }));

  const shutterRowStyle = useAnimatedStyle(() => ({
    height: interpolate(modeProgress.value, [0, 1], [92, 0], Extrapolation.CLAMP),
    opacity: interpolate(modeProgress.value, [0, 0.55], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(modeProgress.value, [0, 1], [1, 0.82], Extrapolation.CLAMP) }],
  }));

  const shutterDiscStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));

  const barcodeHelperStyle = useAnimatedStyle(() => ({
    height: interpolate(modeProgress.value, [0, 1], [0, 44], Extrapolation.CLAMP),
    opacity: interpolate(modeProgress.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  const viewfinderActive = cameraOpen && !showingOutcome && !typing && !labelMode;

  return <View style={styles.screen}>
    {cameraOpen && <NativeBarcodeScannerView
      active={viewfinderActive}
      scanBarcodes={cameraMode === 'barcode' && viewfinderActive && !action.busy}
      captureToken={captureToken}
      torchEnabled={torch}
      onBarcodeScanned={event => {
        const { rawCode, symbology: detected } = event.nativeEvent;
        hapticLight();
        setTorch(false); setCode(rawCode); setSymbology(detected); resolve(rawCode, detected);
      }}
      onPhotoCaptured={event => handlePhotoCaptured(event.nativeEvent)}
      onScannerError={event => {
        setCapturing(false);
        setTorch(false);
        setNotice(event.nativeEvent.message);
      }}
      style={StyleSheet.absoluteFill}
    />}

    {/* Crisp shutter flash overlay */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />

    <SafeAreaView style={styles.overlay} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={close} style={styles.circle}>
          <DoopIcon name="close" size={18} color={colors.ink} />
        </Pressable>
        {!custom && cameraMode === 'barcode' && (
          <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'} accessibilityState={{ selected: torch }} disabled={!cameraOpen} onPress={() => setTorch(value => !value)} style={[styles.circle, torch && styles.circleActive]}>
            <DoopIcon name="torch" size={19} color={torch ? colors.accent : colors.ink} />
          </Pressable>
        )}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.stage}>
        <ErrorMessage message={action.error ?? preferences.error ?? ai.error} />
        {!!notice && <View style={styles.notice}><Muted>{notice}</Muted>{receipt && !found && <Button label="Undo" quiet disabled={action.busy || !receipt.undo} onPress={undo} />}</View>}

        {!labelMode && <>
          {found && <><BarcodeFoundCard name={found.food.name} brand={found.food.brand} sourceLabel={tierLabels[found.tier]}
            basisSummary={`${found.food.basis === 'per_serving' ? 'per serving' : found.food.basis === 'per_100ml' ? 'per 100 ml' : 'per 100 g'} · ${energy(found.food.nutrients.kcal, unit)}`}
            portions={portions.map(({ quantity, nutrients }) => ({ label: quantity.amount === 1 && /^\d/.test(quantity.unit) ? quantity.unit : `${quantity.amount} ${quantity.unit}`, energyText: energy(nutrients.kcal, unit), proteinG: nutrients.protein_g, carbsG: nutrients.carbs_g, fatG: nutrients.fat_g }))}
            selectedIndex={selected} onSelectPortion={index => { setSelected(index); setReceipt(null); }} mealLabel={meal} meals={pickerMeals} busy={action.busy}
            loggedMeal={receipt?.meal} onUndo={undo} onConfirm={() => logFound(meal)} onConfirmMeal={logFound}
            onMore={() => setPortionOpen(open => !open)} onRescan={() => { setResult(null); setCustom(null); changeCode(''); }} />
            {portionOpen && <View style={styles.inputPanel}><Input label={`Custom portion (${found.food.basis === 'per_100ml' ? 'ml' : 'g'})`} value={customAmount} onChangeText={setCustomAmount} keyboardType="decimal-pad" />
              <Button label="Use portion" disabled={!customPortionCandidate} onPress={() => { if (!customPortionCandidate) return; setAppliedCustomPortion(customPortionCandidate.quantity); setSelected(0); setReceipt(null); setPortionOpen(false); }} /></View>}
            {found.attribution && <Text style={styles.attribution}>{found.attribution.name} · {found.attribution.license}{found.attribution.url ? ` · ${found.attribution.url}` : ''}</Text>}
          </>}

          {result?.status === 'not_found' && !custom && <BarcodeNotFoundCard code={result.normalized.rawCode}
            liveLookupNote={result.liveLookupAttempted ? result.liveLookupError ? 'Live Open Food Facts lookup was unavailable. You can still create this food offline.' : 'Open Food Facts was checked; no match found.' : 'Live Open Food Facts lookup is off. Only local foods, food packs and the separate cache were checked.'}
            onCreateCustom={() => setCustom({ id: generateId(), barcode: { rawCode: code, ...(symbology ? { symbology } : {}) }, label: null, energyUnit: unit })}
            canReadLabelWithAI={!!ai.value && ai.value.mode !== 'disconnected' && ai.value.consentAccepted}
            onReadLabelWithAI={() => { if (!ai.value || ai.value.mode === 'disconnected' || !ai.value.consentAccepted) router.push('/chatgpt'); else captureLabel('camera'); }} onTypeAgain={() => { changeCode(''); setTyping(true); }} />}

          {!showingOutcome && !typing && (
            <Animated.View pointerEvents={cameraMode === 'barcode' ? 'auto' : 'none'} style={[styles.reticleWrap, reticleStyle]}>
              <Pressable accessibilityRole="button" accessibilityLabel={cameraOpen ? 'Barcode viewfinder' : 'Open camera scanner'} onPress={() => { if (!cameraOpen) openCamera(); }} style={styles.reticle}>
                <Svg width={248} height={152} viewBox="0 0 248 152">
                  <Path d="M1 27V11Q1 1 11 1H27 M221 1H237Q247 1 247 11V27 M247 125V141Q247 151 237 151H221 M27 151H11Q1 151 1 141V125" stroke={colors.accent} strokeWidth={2} fill="none" />
                </Svg>
                <Animated.View pointerEvents="none" style={[styles.scanBeam, scanBeamStyle]} />
                <View style={styles.barcodeGlyph}><DoopIcon name="barcode" size={44} color={colors.border} /></View>
              </Pressable>
            </Animated.View>
          )}

          {!showingOutcome && typing && <View style={styles.inputPanel}><Heading>Type barcode</Heading><Input label="Barcode digits" value={code} showSoftInputOnFocus={false} autoCorrect={false} onChangeText={changeCode} editable={!action.busy} />
            <InlineKeypad bare value={code} showReadout={false} digitString maxLength={14} onChange={next => { if (!action.busy) changeCode(next); }} />
            {code.length === 8 && <><Muted>Choose the barcode format printed on the packet.</Muted><SegmentedSwitch options={[{ value: 'EAN-8', label: 'EAN-8' }, { value: 'UPC-E', label: 'UPC-E' }]} value={symbology} onChange={setSymbology} /></>}
            <Button label={action.busy ? 'Looking up…' : 'Look up barcode'} primary disabled={action.busy || !code || (code.length === 8 && !symbology)} onPress={() => resolve()} />
            <Button label="Nutrition label text" quiet onPress={() => setLabelMode(true)} />
          </View>}
        </>}

        {labelMode && !custom && <View style={styles.inputPanel}><Heading>Nutrition label</Heading><Muted>Photograph a label with AI, or paste text to review it offline.</Muted>
          <View style={ui.wrap}><Button label="Take label photo" disabled={action.busy || ai.loading} onPress={() => captureLabel('camera')} /><Button label="Pick label photo" disabled={action.busy || ai.loading} onPress={() => captureLabel('library')} /></View>
          {(!ai.value || ai.value.mode === 'disconnected' || !ai.value.consentAccepted) && <Button label="Open ChatGPT settings" quiet onPress={() => router.push('/chatgpt')} />}
          <Input label="Nutrition label text" value={labelText} onChangeText={value => { setLabelText(value); setCustom(null); }} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} placeholder={'Per 100 g\nEnergy 250 kcal\nProtein 8 g\nCarbohydrate 40 g\nFat 6 g'} />
          <Button label="Review label" primary disabled={action.busy || !labelText.trim()} onPress={() => void action.run(async () => { setCustom({ id: generateId(), barcode: null, label: controller.parseLabelText(labelText), energyUnit: unit }); setNotice(''); })} />
        </View>}

        {custom && <><CustomFoodFormCard key={custom.id} initialBarcode={custom.barcode?.rawCode} initialValues={initialValues} energyUnit={formUnit} meals={pickerMeals} busy={action.busy}
          loggedMeal={receipt?.meal} receiptEnergy={receipt?.energyText} onUndo={undo}
          onSaveAndLog={(values, selectedMeal) => saveCustom(values, true, selectedMeal)} onSaveOnly={values => saveCustom(values, false)} onCancel={() => setCustom(null)} />
          {parsed?.warnings.map(warning => <Text key={warning} style={styles.attribution}>{warning}</Text>)}
          {parsed?.serving_ml != null && <Text style={styles.attribution}>Printed serving volume: {parsed.serving_ml} ml. Leave serving weight blank to retain this volume.</Text>}
        </>}
      </ScrollView>

      {!showingOutcome && !labelMode && (
        <View style={styles.bottom}>
          <Animated.View pointerEvents={cameraMode === 'barcode' ? 'auto' : 'none'} style={[styles.barcodeHelpers, barcodeHelperStyle]}>
            <Pressable accessibilityRole="button" onPress={() => setTyping(open => !open)} style={styles.typeButton}>
              <Text style={styles.typeText}>{typing ? 'Scan barcode' : 'Type barcode'}</Text>
            </Pressable>
            {!typing && (
              <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode from photo library" disabled={action.busy} onPress={pickGalleryPhoto} style={styles.typeButton}>
                <Text style={styles.typeText}>From photo</Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Exact Doop Photo | Barcode sliding segmented pill */}
          <View style={styles.segTrack} accessibilityRole="radiogroup">
            <Animated.View pointerEvents="none" style={[styles.segThumb, segThumbStyle]} />
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: cameraMode === 'photo' }}
              onPress={() => switchCameraMode('photo')}
              style={styles.segOption}
            >
              <Text style={[styles.segLabel, cameraMode === 'photo' && styles.segLabelActive]}>Photo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: cameraMode === 'barcode' }}
              onPress={() => switchCameraMode('barcode')}
              style={styles.segOption}
            >
              <Text style={[styles.segLabel, cameraMode === 'barcode' && styles.segLabelActive]}>Barcode</Text>
            </Pressable>
          </View>

          {/* Exact Doop circular shutter button + quiet Gallery & Torch side controls in Photo mode */}
          <Animated.View pointerEvents={cameraMode === 'photo' ? 'auto' : 'none'} style={[styles.shutterRow, shutterRowStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose meal photo from library"
              disabled={action.busy || capturing}
              onPress={pickGalleryPhoto}
              style={[styles.sideCircle, styles.sideLeft]}
            >
              <DoopIcon name="photo" size={19} color={colors.ink} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take meal photo"
              disabled={capturing || action.busy}
              onPressIn={() => { shutterScale.set(withTiming(0.86, { duration: 85 })); }}
              onPressOut={() => { shutterScale.set(withSpring(1, { damping: 16, stiffness: 320 })); }}
              onPress={triggerShutter}
              style={styles.shutterRing}
            >
              <Animated.View style={[styles.shutterDisc, shutterDiscStyle, capturing && { opacity: 0.65 }]} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Turn flash off' : 'Turn flash on'}
              accessibilityState={{ selected: torch }}
              disabled={!cameraOpen || capturing}
              onPress={() => setTorch(value => !value)}
              style={[styles.sideCircle, styles.sideRight, torch && styles.circleActive]}
            >
              <DoopIcon name="torch" size={19} color={torch ? colors.accent : colors.ink} />
            </Pressable>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#12131c' },
  overlay: { flex: 1 },
  flash: { backgroundColor: '#ffffff', zIndex: 20 },
  top: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, marginTop: 10, height: 44, zIndex: 2 },
  circle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(26,27,38,0.68)', alignItems: 'center', justifyContent: 'center' },
  circleActive: { borderWidth: 1, borderColor: 'rgba(122,162,247,0.6)' },
  stage: { flexGrow: 1, paddingHorizontal: 20, paddingVertical: 16, justifyContent: 'center', gap: 8 },
  reticleWrap: { alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 248, height: 152, alignSelf: 'center', overflow: 'hidden' },
  scanBeam: { position: 'absolute', left: 16, right: 16, top: 0, height: 1.5, backgroundColor: colors.accent, borderRadius: 1 },
  barcodeGlyph: { position: 'absolute', left: 102, top: 54 },
  bottom: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 24 },
  barcodeHelpers: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, overflow: 'hidden' },
  typeButton: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' },
  typeText: { ...fontFace('semibold'), color: colors.ink, opacity: 0.78, fontSize: 12 },
  segTrack: {
    position: 'relative',
    width: SEG_WIDTH,
    height: 42,
    padding: SEG_PAD,
    borderRadius: 21,
    backgroundColor: 'rgba(26,27,38,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(192,202,245,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  segThumb: {
    position: 'absolute',
    left: SEG_PAD,
    top: SEG_PAD,
    width: SEG_THUMB_WIDTH,
    height: 42 - SEG_PAD * 2 - 2,
    borderRadius: 18,
  },
  segOption: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  segLabel: { ...fontFace('semibold'), fontSize: 13, color: colors.ink, opacity: 0.82 },
  segLabelActive: { color: colors.onAccent, opacity: 1 },
  shutterRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  shutterRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,27,38,0.22)',
  },
  shutterDisc: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.ink,
  },
  sideCircle: {
    position: 'absolute',
    bottom: 15,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(26,27,38,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLeft: { left: 26 },
  sideRight: { right: 26 },
  inputPanel: { padding: 16, gap: 12, backgroundColor: colors.surface, borderRadius: radius.r16, width: '100%', maxWidth: 430, alignSelf: 'center' },
  notice: { padding: 12, gap: 8, backgroundColor: 'rgba(26,27,38,0.88)', borderRadius: radius.r12, borderWidth: 1, borderColor: colors.hairline },
  attribution: { ...fontFace(), color: colors.muted, fontSize: 10, lineHeight: 14, opacity: 0.7, marginTop: 4 },
});
