import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M5.967 18.833a.76.76 0 0 1-.56-.231.78.78 0 0 1-.227-.565V9.771q0-.325.227-.557a.76.76 0 0 1 .563-.23q.334 0 .564.23.23.232.229.557v6.366L18.18 4.717a.7.7 0 0 1 .545-.236.8.8 0 0 1 .559.24.76.76 0 0 1 .241.554q0 .312-.241.546L7.867 17.25h6.367q.333 0 .564.232a.76.76 0 0 1 .232.558q0 .334-.232.564a.77.77 0 0 1-.564.23z'
    />
  </Svg>
);
export default SvgComponent;
