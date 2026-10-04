import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='m19.25 9.942-6.224 6.224a1.5 1.5 0 0 1-.52.345q-.28.105-.587.106-.306 0-.59-.106a1.5 1.5 0 0 1-.522-.346L3.702 9.06a.78.78 0 0 1-.237-.552.78.78 0 0 1 .222-.565.82.82 0 0 1 1.151.003l7.08 7.087L18.2 8.75H13.93a.77.77 0 0 1-.565-.232.77.77 0 0 1-.231-.562q0-.33.231-.56a.77.77 0 0 1 .565-.23h6.116q.324 0 .556.233.231.232.232.555v6.234q0 .333-.233.564a.76.76 0 0 1-.557.231.76.76 0 0 1-.564-.23.77.77 0 0 1-.23-.565z'
    />
  </Svg>
);
export default SvgComponent;
