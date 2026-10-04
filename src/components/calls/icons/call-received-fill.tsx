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
        d='M6.404 18.5a.87.87 0 0 1-.644-.26.87.87 0 0 1-.26-.644V9.75q0-.318.216-.534A.73.73 0 0 1 6.25 9q.32 0 .535.216A.73.73 0 0 1 7 9.75v6.196L17.92 5.027a.72.72 0 0 1 .521-.212.7.7 0 0 1 .532.212q.217.217.217.527a.72.72 0 0 1-.217.527L8.053 17h6.197q.319 0 .534.215a.73.73 0 0 1 .216.534q0 .32-.216.535a.73.73 0 0 1-.534.215z'
      />
    </G>
  </Svg>
);
export default SvgComponent;
