import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M8.117 17.313V6.578a.73.73 0 0 1 .24-.57.8.8 0 0 1 .56-.216q.096 0 .206.022a.7.7 0 0 1 .21.08l8.438 5.393q.18.133.273.298t.094.365a.7.7 0 0 1-.094.365.9.9 0 0 1-.273.29l-8.437 5.393a.6.6 0 0 1-.212.087 1 1 0 0 1-.201.023.81.81 0 0 1-.564-.216.74.74 0 0 1-.24-.579m1.583-1.43 6.184-3.933L9.7 8.017z'
    />
  </Svg>
);
export default SvgComponent;
