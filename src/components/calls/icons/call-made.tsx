import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M17.245 7.854 5.83 19.284a.73.73 0 0 1-.554.235.8.8 0 0 1-.559-.244.75.75 0 0 1 .002-1.106L16.133 6.75H9.766a.75.75 0 0 1-.56-.234.78.78 0 0 1-.227-.56q0-.327.227-.558a.76.76 0 0 1 .56-.231h8.267q.333 0 .565.232a.76.76 0 0 1 .23.555v8.267q0 .333-.231.565a.77.77 0 0 1-.567.23.75.75 0 0 1-.56-.23.78.78 0 0 1-.225-.565z'
    />
  </Svg>
);
export default SvgComponent;
