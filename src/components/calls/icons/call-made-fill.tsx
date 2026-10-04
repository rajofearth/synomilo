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
        d='M17 8.054 6.083 18.973a.72.72 0 0 1-.522.213.7.7 0 0 1-.532-.213.72.72 0 0 1-.217-.527q0-.31.217-.527L15.947 7H9.751a.73.73 0 0 1-.535-.216.73.73 0 0 1-.215-.534q0-.32.215-.535a.73.73 0 0 1 .535-.215h7.846q.383 0 .644.26.26.26.26.644v7.846q0 .319-.216.534a.73.73 0 0 1-.535.216.73.73 0 0 1-.534-.216.73.73 0 0 1-.215-.534z'
      />
    </G>
  </Svg>
);
export default SvgComponent;
