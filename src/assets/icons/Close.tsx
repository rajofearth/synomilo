import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M11.999 13.117 6.895 18.22a.763.763 0 0 1-1.117-.004.766.766 0 0 1 .004-1.1l5.1-5.117-5.1-5.117a.74.74 0 0 1-.229-.544q0-.315.23-.556a.74.74 0 0 1 .55-.244.78.78 0 0 1 .562.232l5.104 5.112 5.112-5.112a.75.75 0 0 1 .555-.232.78.78 0 0 1 .562.244.76.76 0 0 1 .223.556.77.77 0 0 1-.235.544L13.116 12l5.1 5.117a.74.74 0 0 1 .229.543q0 .314-.23.557a.74.74 0 0 1-.55.243.74.74 0 0 1-.553-.24z'
    />
  </Svg>
);
export default SvgComponent;
