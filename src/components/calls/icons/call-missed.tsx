import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M4.751 9.942v4.246q0 .333-.233.564a.76.76 0 0 1-.557.231.76.76 0 0 1-.564-.23.77.77 0 0 1-.229-.565V7.954a.76.76 0 0 1 .231-.555.77.77 0 0 1 .565-.232h6.117q.323 0 .555.233.232.232.232.557a.76.76 0 0 1-.232.564.76.76 0 0 1-.555.23H5.8l6.284 6.282 7.11-7.11a.72.72 0 0 1 .557-.227.86.86 0 0 1 .568.25.8.8 0 0 1 .219.562.77.77 0 0 1-.238.55l-7.107 7.107q-.238.24-.52.346-.28.105-.587.106-.306 0-.59-.106a1.5 1.5 0 0 1-.521-.345z'
    />
  </Svg>
);
export default SvgComponent;
