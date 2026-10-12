// The surface module laid over a drawn control (drawnButton in kit.tsx): a
// press anywhere on it posts, and the press hook in pane.tsx runs what the
// drawing registered under this Client's key. It draws nothing itself.
import type { ClientModule } from 'claude-code'

const Press: ClientModule<Record<string, never>, true> = (props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    surface.setState(true)
    surface.onPointer(event => {
      if (event.type === 'down' && event.button !== 'right') surface.post({ press: true })
    })
  }
  return <Box width={surface.columns} height={surface.rows} />
}

export default Press
