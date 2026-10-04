import Svg, { Mask, Path, G } from "react-native-svg";
import type { SvgProps } from "react-native-svg";
const SvgComponent = ({ height, width, color }: SvgProps) => (
  <Svg width={width} height={height} fill='none' viewBox='0 0 24 24'>
    <Mask
      id='prefix__a'
      width={24}
      height={24}
      x={0}
      y={0}
      maskUnits='userSpaceOnUse'
      style={{
        maskType: "alpha",
      }}
    >
      <Path fill='#D9D9D9' d='M0 0h24v24H0z' />
    </Mask>
    <G mask='url(#prefix__a)'>
      <Path
        fill={color}
        d='m9.551 15.516 8.639-8.639a.73.73 0 0 1 .522-.228q.299-.005.532.228a.74.74 0 0 1 .232.535q0 .302-.232.534l-9.06 9.075a.87.87 0 0 1-.633.271.87.87 0 0 1-.633-.27l-4.175-4.176a.71.71 0 0 1-.22-.53.75.75 0 0 1 .236-.539.74.74 0 0 1 .534-.233q.303 0 .535.233z'
      />
    </G>
  </Svg>
);
export default SvgComponent;