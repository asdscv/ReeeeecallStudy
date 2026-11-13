import { useRef, useState, type ReactNode } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, type ViewStyle, type View as RNView } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Feather } from '@expo/vector-icons'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { MAZE_WALL, SET_COLORS, type CodeBreakView, type MakeNumberView, type MazeView, type SetCard, type SetMatchView } from '@reeeeecall/shared/lib/brain-games'
import { mazeDragCells, mazePoint } from '@reeeeecall/shared/lib/brain-games/maze-drag'
import type { BoardProps } from './BrainBoard'
import { useDrain } from './motion'

type Props<V> = BoardProps & { view: V }
function Tap({ index, onTap, disabled, demo, children, label, style, selected, registerTarget }: {
  index: number; onTap: (index: number) => void; disabled?: boolean; demo?: boolean; children: ReactNode; label?: string; style?: ViewStyle; selected?: boolean; registerTarget?: (i: number, node: RNView | null) => void
}) {
  return <Pressable ref={(node) => registerTarget?.(index, node)} disabled={disabled || demo} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, selected }} onPress={() => onTap(index)} testID={demo ? undefined : `brain-tap-${index}`}
    style={({ pressed }) => [styles.button, { minHeight: demo ? 30 : 56, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}>
    {typeof children === 'string' || typeof children === 'number' ? <Text style={[styles.buttonText, { fontSize: demo ? 16 : typeof children === 'number' || (typeof children === 'string' && children.length <= 2) ? 28 : 18 }]}>{children}</Text> : children}
  </Pressable>
}
function Symbol({ card, size }: { card: SetCard; size: number }) {
  const color = SET_COLORS[card.color]
  if (card.shape === 'triangle') {
    if (card.fill === 'striped') return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      {Array.from({ length: 6 }, (_, i) => <View key={i} style={{ width: size * (i + 1) / 6, height: size / 9, marginTop: size / 18, backgroundColor: color }} />)}
    </View>
    return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 0, height: 0, borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: size, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
      {card.fill === 'outline' && <View style={{ position: 'absolute', top: 5, width: 0, height: 0, borderLeftWidth: (size - 9) / 2, borderRightWidth: (size - 9) / 2, borderBottomWidth: size - 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff' }} />}
    </View>
  }
  const diamond = card.shape === 'diamond'
  const s = diamond ? size * 0.7 : size
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: s, height: s, borderWidth: 2, borderColor: color, borderRadius: card.shape === 'circle' ? s / 2 : 1, backgroundColor: card.fill === 'solid' ? color : '#fff', overflow: 'hidden', transform: [{ rotate: diamond ? '45deg' : '0deg' }] }}>
      {card.fill === 'striped' && Array.from({ length: 6 }, (_, i) => <View key={i} style={{ position: 'absolute', left: i * s / 6, width: 2, top: 0, bottom: 0, backgroundColor: color }} />)}
    </View>
  </View>
}
function Frame({ width, height, demo, children }: Pick<BoardProps, 'width' | 'height' | 'demo'> & { children: ReactNode }) {
  return <ScrollView style={{ width, maxHeight: height }} contentContainerStyle={{ gap: demo ? 5 : 10, paddingBottom: demo ? 0 : 4 }} showsVerticalScrollIndicator={!demo} scrollEnabled={!demo}>{children}</ScrollView>
}

export function SetMatchBoard({ view, onTap, width, height, demo, registerTarget }: Props<SetMatchView>) {
  const { t } = useTranslation('brain')
  const gap = demo ? 5 : 8, cardW = (width - gap * (view.cols - 1)) / view.cols
  const size = Math.min(demo ? 18 : 28, (cardW - 14) / 3)
  return <Frame width={width} height={height} demo={demo}>
    <Text style={[styles.hint, { fontSize: demo ? 12 : 16 }]}>{view.vary.map((a) => t(`play.setAttribute.${a}`)).join(' · ')} · {t('play.setPicked', { count: view.picked })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {view.cards.map(({ card, tone }, i) => <Tap key={i} index={i} onTap={onTap} demo={demo} disabled={view.locked} registerTarget={registerTarget} selected={tone === 'lit'}
        label={[t('play.setCard', { count: card.count }), t(`play.setShape.${card.shape}`), t(`play.setColor.${card.color}`), t(`play.setFill.${card.fill}`)].join(', ')}
        style={{ width: cardW, minHeight: demo ? 42 : 64, backgroundColor: '#fff', borderWidth: 4, borderColor: tone === 'lit' ? '#F0E442' : tone === 'correct' || tone === 'missed' ? '#56B4E9' : tone === 'wrong' ? '#D55E00' : 'transparent' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{Array.from({ length: card.count }, (_, k) => <Symbol key={k} card={card} size={size} />)}</View>
        {(tone === 'correct' || tone === 'missed' || tone === 'wrong') && <Text style={{ position: 'absolute', right: 0, top: 0, color: '#0F172A', fontSize: 12 }}>{tone === 'wrong' ? '×' : '✓'}</Text>}
      </Tap>)}
    </View>
    {view.extra && <Tap {...view.extra} onTap={onTap} demo={demo} disabled={view.locked} registerTarget={registerTarget}>{t(view.extra.key)}</Tap>}
    {view.broken && view.broken.length > 0 && <Text accessibilityLiveRegion="polite" style={styles.hint}>{t('play.setBroken', { attributes: view.broken.map((a) => t(`play.setAttribute.${a}`)).join(' · ') })}</Text>}
    {view.answer?.length === 0 && <Text style={styles.hint}>{t('play.noneWas')}</Text>}
  </Frame>
}

export function CodeBreakBoard({ view, onTap, width, height, demo, registerTarget }: Props<CodeBreakView>) {
  const { t } = useTranslation('brain')
  const [notesOpen, setNotesOpen] = useState(false)
  const history = useRef<ScrollView>(null)
  const cols = Math.min(5, Math.max(3, Math.floor((width + 8) / 64)), view.keys.length), gap = demo ? 5 : 8, keyW = (width - (cols - 1) * gap) / cols
  return <Frame width={width} height={height} demo={demo}>
    <Text style={[styles.hint, { fontSize: demo ? 12 : 16 }]}>{t('play.codeGuesses', { used: view.guesses.length, total: view.maxGuesses })} · {t(view.repeats ? 'play.codeRepeats' : 'play.codeDistinct')}</Text>
    <ScrollView ref={history} nestedScrollEnabled style={{ maxHeight: demo ? 64 : 130, minHeight: demo ? 28 : 44, backgroundColor: '#0003', borderRadius: 12 }}
      onContentSizeChange={() => history.current?.scrollToEnd({ animated: false })} accessibilityLabel={t('play.codeHistory')}>
      {view.guesses.length === 0 ? <Text style={styles.hint}>{t('play.codeFirstGuess')}</Text> : view.guesses.map((g, i) => <View key={i} style={styles.historyRow}>
        <Text style={{ color: '#fff', fontSize: demo ? 16 : 26, fontWeight: '700', letterSpacing: 4 }}>{g.digits.join('')}</Text>
        <Text style={{ color: '#fff', fontSize: demo ? 11 : 16 }}>{t('play.codeFeedback', { strikes: g.strikes, balls: g.balls })}</Text>
      </View>)}
    </ScrollView>
    <View style={styles.entry} accessibilityLabel={t('play.codeEntry')}>
      {Array.from({ length: view.length }, (_, i) => <View key={i} style={[styles.entryCell, { width: demo ? 28 : 48, height: demo ? 30 : 52 }]}><Text style={{ fontSize: demo ? 18 : 30, fontWeight: '700', color: '#fff' }}>{view.entry[i] ?? '·'}</Text></View>)}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{view.keys.map((k) => <Tap key={k.digit} {...k} disabled={k.disabled || view.locked} demo={demo} onTap={onTap} registerTarget={registerTarget} style={{ width: keyW }}>{k.digit}</Tap>)}</View>
    <View style={styles.row}>
      <Tap {...view.del} disabled={view.del.disabled || view.locked} onTap={onTap} demo={demo} registerTarget={registerTarget} style={styles.flex}>{t('play.erase')}</Tap>
      <Tap {...view.submit} disabled={view.submit.disabled || view.locked} onTap={onTap} demo={demo} registerTarget={registerTarget} style={styles.flex}>{t('play.submit')}</Tap>
    </View>
    {!demo && <Pressable style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => setNotesOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: notesOpen }}><Text style={[styles.hint, { textDecorationLine: 'underline' }]}>{t('play.codeNotes')}</Text></Pressable>}
    {notesOpen && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{view.notes.map((n) => <Tap key={n.digit} {...n} onTap={onTap} demo={demo} selected={n.crossed} label={t('play.codeNote', { digit: n.digit })} style={{ width: keyW }}><Text style={{ color: '#fff', fontSize: 28, textDecorationLine: n.crossed ? 'line-through' : 'none', opacity: n.crossed ? 0.5 : 1 }}>{n.digit}</Text></Tap>)}</View>}
    {view.secret && <Text style={styles.hint} accessibilityLiveRegion="polite">{t('play.codeAnswer', { code: view.secret.join('') })}</Text>}
  </Frame>
}

export function MakeNumberBoard({ view, onTap, width, height, demo, registerTarget }: Props<MakeNumberView>) {
  const { t } = useTranslation('brain')
  const expression = view.expression.map((x) => x.kind === 'num' ? x.value : x.op).join(' ')
  const signs = view.expression.filter((x) => x.kind === 'op')
  return <Frame width={width} height={height} demo={demo}>
    <Text style={[styles.hint, { fontSize: demo ? 18 : 30, fontWeight: '700' }]}>{t('play.makeTarget', { target: view.target })}</Text>
    <Text style={[styles.hint, { fontSize: demo ? 12 : 16 }]}>{t(view.order === 'fixed' ? 'play.makeFixed' : 'play.makeAny')} · {t('play.makeTries', { count: view.tries.left })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
      {view.tiles.map((n, i) => <View key={n.index} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Tap {...n} demo={demo} onTap={onTap} registerTarget={registerTarget} style={{ minWidth: demo ? 28 : 56, backgroundColor: '#fff', opacity: n.used ? 0.5 : 1 }}><Text style={{ color: '#0F172A', fontSize: demo ? 18 : 28, fontWeight: '700' }}>{n.value}</Text></Tap>
        {view.order === 'fixed' && i < view.tiles.length - 1 && <Text style={{ fontSize: demo ? 16 : 24, color: '#fff' }}>{signs[i]?.kind === 'op' ? signs[i].op : '□'}</Text>}
      </View>)}
    </View>
    <Text style={[styles.expression, { fontSize: demo ? 18 : 28, minHeight: demo ? 30 : 60 }]} accessibilityLabel={t('play.makeExpression')} accessibilityLiveRegion="polite">{expression || '…'}{view.preview !== undefined ? ` = ${view.preview}` : ''}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{view.ops.map((o) => <Tap key={o.op} {...o} disabled={o.disabled || view.locked} onTap={onTap} demo={demo} registerTarget={registerTarget} style={{ width: (width - (Math.min(4, view.ops.length) - 1) * 8) / Math.min(4, view.ops.length) }}>{o.op}</Tap>)}</View>
    <View style={styles.row}>
      <Tap {...view.undo} onTap={onTap} demo={demo} registerTarget={registerTarget} style={styles.flex}>{t('play.undo')}</Tap>
      <Tap {...view.clear} onTap={onTap} demo={demo} registerTarget={registerTarget} style={styles.flex}>{t('play.clear')}</Tap>
      <Tap {...view.submit} onTap={onTap} demo={demo} registerTarget={registerTarget} style={styles.flex}>{t('play.submit')}</Tap>
    </View>
    {view.lastValue !== undefined && <Text style={styles.hint} accessibilityLiveRegion="polite">{t('play.makeValue', { value: view.lastValue })}</Text>}
    {view.reveal && <Text style={styles.hint}>{view.reveal.lines.join(' · ')}</Text>}
  </Frame>
}

export function MazeBoard({ view, onTap, width, height, demo, paused, registerTarget }: Props<MazeView>) {
  const { t } = useTranslation('brain')
  const cell = Math.max(demo ? 20 : view.hidden ? 56 : 44, Math.floor(Math.min(width / view.cols, (height - (demo ? 32 : 44)) / view.rows, demo ? 48 : 72)))
  const w = cell * view.cols, h = cell * view.rows
  const locked = view.locked || !!demo || !!paused
  const current = view.path[view.path.length - 1], path = view.answer?.path ?? view.path, walls = view.answer?.walls ?? view.walls
  const lastX = useSharedValue(0), lastY = useSharedValue(0), cursorX = useSharedValue(0), cursorY = useSharedValue(0), active = useSharedValue(false)
  const send = (indices: number[]) => indices.forEach(onTap)
  const pan = Gesture.Pan().enabled(!locked).minDistance(0)
    .onBegin((e) => {
      const p = mazePoint(e.x / cell, e.y / cell, view.cols, view.rows)
      lastX.value = p.x; lastY.value = p.y; cursorX.value = e.x; cursorY.value = e.y; active.value = true
      runOnJS(send)([Math.floor(p.y) * view.cols + Math.floor(p.x)])
    })
    .onUpdate((e) => {
      const p = mazePoint(e.x / cell, e.y / cell, view.cols, view.rows)
      const cells = mazeDragCells({ x: lastX.value, y: lastY.value }, p, view.cols, view.rows)
      lastX.value = p.x; lastY.value = p.y; cursorX.value = e.x; cursorY.value = e.y
      if (cells.length > 0) runOnJS(send)(cells)
    }).onFinalize(() => { active.value = false })
  const cursor = useAnimatedStyle(() => ({ opacity: active.value ? 0.5 : 0, transform: [{ translateX: cursorX.value - 10 }, { translateY: cursorY.value - 10 }] }))
  return <GestureHandlerRootView style={{ width, alignItems: 'center', gap: 8 }} testID={demo ? undefined : 'brain-maze'}>
    <Text style={[styles.hint, { fontSize: demo ? 12 : 16 }]}>{t(view.phase === 'preview' ? 'play.mazeMemorise' : 'play.mazeDrag')}{view.budget ? ` · ${t('play.mazeBumps', { count: view.budget.left })}` : ''}</Text>
    <GestureDetector gesture={pan}>
      <View style={{ width: w, height: h, backgroundColor: '#020617', borderRadius: 8 }} collapsable={false}>
        {path.slice(1).map((i, k) => {
          const a = path[k], x = (a % view.cols + 0.5) * cell, y = (Math.floor(a / view.cols) + 0.5) * cell
          const xx = (i % view.cols + 0.5) * cell, yy = (Math.floor(i / view.cols) + 0.5) * cell
          return <View key={k} pointerEvents="none" style={{ position: 'absolute', left: Math.min(x, xx) - 3, top: Math.min(y, yy) - 3, width: Math.abs(xx - x) + 6, height: Math.abs(yy - y) + 6, backgroundColor: view.answer ? '#E69F00' : '#56B4E9', borderRadius: 3, opacity: 0.8 }} />
        })}
        {walls.map((wall, i) => {
          const key = view.keys.find((k) => k.cell === i), bump = view.bump?.cell === i ? view.bump.side : 0
          const border = (bit: number) => wall & bit ? 2 : bump & bit ? 4 : 0.5
          const color = (bit: number) => bump & bit ? '#E69F00' : wall & bit ? '#F8FAFC' : '#ffffff12'
          return <Pressable key={i} ref={(node) => registerTarget?.(i, node)} disabled={locked} onPress={() => onTap(i)} accessibilityRole="button"
            accessibilityLabel={key ? t('play.mazeKey', { count: key.order }) : i === view.goal ? t('play.mazeGoal') : i === view.start ? t('play.mazeStart') : String(i + 1)} accessibilityState={{ selected: i === current, disabled: locked }}
            testID={demo ? undefined : `brain-maze-cell-${i}`}
            style={{ position: 'absolute', left: i % view.cols * cell, top: Math.floor(i / view.cols) * cell, width: cell, height: cell, alignItems: 'center', justifyContent: 'center', borderTopWidth: border(MAZE_WALL.top), borderRightWidth: border(MAZE_WALL.right), borderBottomWidth: border(MAZE_WALL.bottom), borderLeftWidth: border(MAZE_WALL.left), borderTopColor: color(MAZE_WALL.top), borderRightColor: color(MAZE_WALL.right), borderBottomColor: color(MAZE_WALL.bottom), borderLeftColor: color(MAZE_WALL.left) }}>
            {key && !key.taken ? <View style={styles.row}><Feather name="key" size={demo ? 12 : 18} color="#E69F00" /><Text style={{ color: '#E69F00', fontSize: demo ? 12 : 22 }}>{key.order}</Text></View> : i === view.goal ? <Feather name="flag" size={demo ? 16 : 24} color={view.goalOpen ? '#F0E442' : '#94A3B8'} /> : <Text style={{ color: '#fff', fontSize: demo ? 16 : 26 }}>{i === current ? '●' : i === view.start ? 'S' : ''}</Text>}
          </Pressable>
        })}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: '#56B4E9' }, cursor]} />
      </View>
    </GestureDetector>
    {view.showBar && <PreviewBar key={view.showBar.ms} ms={view.showBar.ms} paused={!!paused} width={w} />}
  </GestureHandlerRootView>
}
function PreviewBar({ ms, paused, width }: { ms: number; paused: boolean; width: number }) {
  const drain = useDrain(ms, paused)
  return <View style={{ width, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#ffffff26' }}><Animated.View style={[{ width, height: 6, backgroundColor: '#7DD3FC' }, drain]} /></View>
}
const styles = StyleSheet.create({
  button: { borderRadius: 12, borderWidth: 2, borderColor: '#ffffff40', backgroundColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  hint: { color: '#ffffffe0', fontSize: 16, textAlign: 'center' },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 8, paddingVertical: 4 },
  entry: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  entryCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 2, borderColor: '#ffffff80', backgroundColor: '#ffffff1a' },
  expression: { color: '#fff', fontWeight: '700', backgroundColor: '#0003', borderRadius: 12, textAlign: 'center', padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
})
