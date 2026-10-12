// The surface module laid over a drawn control (drawnButton in kit.tsx): a
// press anywhere on it posts, and the press hook in pane.tsx runs what the
// drawing registered under this Client's key. Given `hovers`, the pointer
// entering and leaving posts too, so the control can light. It draws nothing.
import type { ClientModule } from 'claude-code'

type Props = { hovers?: boolean }

const Press: ClientModule<Props, true> = (props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    surface.setState(true)
    const hovers = props.hovers === true
    surface.onPointer(event => {
      if (event.type === 'down' && event.button !== 'right') surface.post({ press: true })
      else if (hovers && event.type === 'enter') surface.post({ hover: true })
      else if (hovers && event.type === 'leave') surface.post({ hover: false })
    })
  }
  // The whole drawing, to the pixel: a size in whole cells left a pill's
  // right and bottom edges dead (and all of it before the first layout,
  // when the cells are 0).
  return <Box width="100%" height="100%" />
}

export default Press
