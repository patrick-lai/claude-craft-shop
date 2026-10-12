// The surface module laid over the rail's picture (rail-art.ts): a press
// opens the segment under the pointer, and hovering one says which, so the
// hooks module can light it and show its caption. It draws nothing itself.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { width: number; segments: { x0: number; x1: number; tab: string }[] }
type State = { hover: number | null }

// The handlers are set once; they read the latest props.
let latest: Props = { width: 1, segments: [] }

const RailClick: ClientModule<Props, State> = (next, surface) => {
  latest = next
  const { Box } = surface.elements

  const segmentAt = (event: ClientPointerEvent): number | null => {
    const x = ((event.fine?.x ?? event.x + 0.5) / Math.max(1, surface.columns)) * latest.width
    const index = latest.segments.findIndex(one => x >= one.x0 && x <= one.x1)
    return index === -1 ? null : index
  }

  if (surface.state === undefined) {
    surface.setState({ hover: null })
    surface.onPointer(event => {
      const hover = event.type === 'leave' ? null : segmentAt(event)
      if (event.type === 'down' && hover !== null) {
        surface.post({ open: latest.segments[hover]!.tab })
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
