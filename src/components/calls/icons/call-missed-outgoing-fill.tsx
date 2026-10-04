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
        d='m19 10.021-5.767 5.768q-.272.27-.608.401a1.8 1.8 0 0 1-.673.131q-.336 0-.673-.13a1.75 1.75 0 0 1-.608-.402L4.017 9.135a.72.72 0 0 1-.212-.515.75.75 0 0 1 .212-.54.74.74 0 0 1 .535-.232q.302 0 .535.233l6.644 6.644a.3.3 0 0 0 .221.087q.134 0 .221-.087l5.773-5.773H13.75a.73.73 0 0 1-.534-.215.73.73 0 0 1-.216-.535q0-.32.216-.535a.73.73 0 0 1 .534-.215h5.846q.387 0 .645.259a.88.88 0 0 1 .259.645v5.846a.73.73 0 0 1-.215.534.73.73 0 0 1-.535.216.73.73 0 0 1-.535-.216.73.73 0 0 1-.215-.534z'
      />
    </G>
  </Svg>
);
export default SvgComponent;
