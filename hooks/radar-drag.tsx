// The surface module laid over the Dials radar: press a dial's dot (or
// anywhere along its spoke) and drag it in or out to set its level, as on
// CommissionAI's Dials page; arrow keys move the focus between dials and the
// level up or down. It draws nothing of its own (the radar is the Svg beneath)
// and posts { dial, level } to the hooks module, which validates it.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { levels: number[]; width: number; height: number; radius: number }
type State = { axis: number | null; focus: number }

function angleOf(index: number, count: number): number {
  return ((-90 + (index * 360) / count) * Math.PI) / 180
}

// The handlers are set once, on the first call; they read the props of the
// latest one, so a drag compares against the levels drawn now.
let latest: Props = { levels: [], width: 1, height: 1, radius: 1 }

const RadarDrag: ClientModule<Props, State> = (next, surface) => {
  latest = next
  const props = new Proxy({} as Props, { get: (_, key) => latest[key as keyof Props] })
  const { Box } = surface.elements
  const count = props.levels.length

  // Where a pointer event lands, in the radar's own pixels.
  const point = (event: ClientPointerEvent) => {
    const columns = Math.max(1, surface.columns)
    const rows = Math.max(1, surface.rows)
    return {
      x: (((event.fine?.x ?? event.x + 0.5) / columns) * props.width) - props.width / 2,
      y: (((event.fine?.y ?? event.y + 0.5) / rows) * props.height) - props.height / 2,
    }
  }

  const nearestAxis = (x: number, y: number) => {
    const pointer = Math.atan2(y, x)
    let best = 0
    let gap = Infinity
    for (let index = 0; index < count; index++) {
      const delta = Math.abs(Math.atan2(Math.sin(pointer - angleOf(index, count)), Math.cos(pointer - angleOf(index, count))))
      if (delta < gap) {
        gap = delta
        best = index
      }
    }
    return best
  }

  const levelAlong = (axis: number, x: number, y: number) => {
    const angle = angleOf(axis, count)
    const along = x * Math.cos(angle) + y * Math.sin(angle)
    return Math.min(5, Math.max(1, Math.round((along / props.radius) * 5)))
  }

  // One post per frame reaches the hooks module (a later one replaces it), so
  // a press says which dial it selects and its level together.
  const post = (dial: number, level: number, isSelecting = false) => {
    if (isSelecting) surface.post({ select: dial, dial, level })
    else if (props.levels[dial] !== level) surface.post({ dial, level })
  }

  if (surface.state === undefined) {
    surface.setState({ axis: null, focus: 0 })
    surface.onPointer(event => {
      const state = surface.state ?? { axis: null, focus: 0 }
      const { x, y } = point(event)
      if (event.type === 'down') {
        // Only presses within the radar's reach grab a dial.
        if (Math.hypot(x, y) > props.radius * 1.25) return
        const axis = nearestAxis(x, y)
        surface.setState({ axis, focus: axis })
        post(axis, levelAlong(axis, x, y), true)
      } else if (event.type === 'move' && state.axis !== null) {
        post(state.axis, levelAlong(state.axis, x, y))
      } else if (event.type === 'up' && state.axis !== null) {
        surface.setState({ axis: null, focus: state.focus })
      }
    })
    surface.onKey(event => {
      const state = surface.state ?? { axis: null, focus: 0 }
      const step = event.key === 'right' || event.key === 'tab' ? 1 : event.key === 'left' ? count - 1 : 0
      const focus = (state.focus + step) % count
      const level = props.levels[focus] ?? 3
      const delta = event.key === 'up' ? 1 : event.key === 'down' ? -1 : 0
      if (step === 0 && delta === 0) return
      surface.setState({ ...state, focus })
      post(focus, Math.min(5, Math.max(1, level + delta)), true)
    })
  }

  return <Box width={surface.columns} height={surface.rows} />
}

export default RadarDrag
