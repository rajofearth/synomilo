import Svg, { Path } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Path
      fill={color}
      d='M3.779 19.85q-.64 0-1.112-.471a1.52 1.52 0 0 1-.472-1.112V5.733q0-.64.472-1.112a1.52 1.52 0 0 1 1.112-.471h12.537q.627 0 1.104.471.475.471.475 1.112v5.1L21.13 7.6a.38.38 0 0 1 .433-.09q.25.095.25.357v8.27q0 .257-.25.352a.38.38 0 0 1-.433-.09l-3.234-3.232v5.1q0 .64-.475 1.112-.477.47-1.104.47zm0-1.583h12.533V5.733H3.78z'
    />
  </Svg>
);
export default SvgComponent;
