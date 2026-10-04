import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='m7.193 12.787 5.366 5.367a.8.8 0 0 1 .24.563.75.75 0 0 1-.236.554.79.79 0 0 1-.562.243.74.74 0 0 1-.554-.243L4.73 12.554a.75.75 0 0 1-.185-.256.8.8 0 0 1-.057-.298.8.8 0 0 1 .057-.298.8.8 0 0 1 .185-.265l6.717-6.716a.76.76 0 0 1 .552-.234q.318 0 .564.234a.8.8 0 0 1 .238.564q0 .319-.238.557l-5.37 5.362h11.854a.76.76 0 0 1 .558.23.77.77 0 0 1 .229.566.76.76 0 0 1-.229.562.77.77 0 0 1-.558.225z'
    />
  </Svg>
);
export default SvgComponent;
