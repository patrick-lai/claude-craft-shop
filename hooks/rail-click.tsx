// The surface module laid over the rail's picture (rail-art.ts): a press
// opens the segment under the pointer, and hovering one says which, so the
// hooks module can light it and show its caption. It draws nothing itself.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { width: number; segments: { x0: number; x1: number; tab: string }[] }
type State = { hover: number | null }

// The handlers are set once; they read the latest props of their own
// instance. The rail and the pane's tab bar both run this module, so one
// shared value would map the rail's pointer through the tab bar's segments.
const latestBySurface = new WeakMap<object, Props>()

const RailClick: ClientModule<Props, State> = (next, surface) => {
  latestBySurface.set(surface, next)
  const { Box } = surface.elements

  const segmentAt = (event: ClientPointerEvent): number | null => {
    const latest = latestBySurface.get(surface) ?? next
    const x = ((event.fine?.x ?? event.x + 0.5) / Math.max(1, surface.columns)) * latest.width
    const index = latest.segments.findIndex(one => x >= one.x0 && x <= one.x1)
    return index === -1 ? null : index
  }

  if (surface.state === undefined) {
    surface.setState({ hover: null })
    surface.onPointer(event => {
      const hover = event.type === 'leave' ? null : segmentAt(event)
      if (event.type === 'down' && hover !== null) {
        surface.post({ open: (latestBySurface.get(surface) ?? next).segments[hover]!.tab })
        return
      }
      if (hover !== (surface.state?.hover ?? null)) {
        surface.setState({ hover })
        surface.post({ hover })
      }
    })
  }

  return <Box width={surface.columns} height={surface.rows} />
}

export default RailClick
