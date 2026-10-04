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
        d='m6.039 17.5-2.002 2.002q-.427.426-.982.192-.555-.235-.555-.84V4.308q0-.758.525-1.283T4.308 2.5h15.384q.758 0 1.283.525t.525 1.283v11.384q0 .758-.525 1.283t-1.283.525zM7 13.75h6q.319 0 .534-.216A.73.73 0 0 0 13.75 13a.73.73 0 0 0-.216-.534.73.73 0 0 0-.534-.216H7a.73.73 0 0 0-.534.216.73.73 0 0 0-.216.534q0 .32.216.534A.73.73 0 0 0 7 13.75m0-3h10q.318 0 .534-.216A.73.73 0 0 0 17.75 10a.73.73 0 0 0-.216-.534A.73.73 0 0 0 17 9.25H7a.73.73 0 0 0-.534.216.73.73 0 0 0-.216.534q0 .32.216.534A.73.73 0 0 0 7 10.75m0-3h10q.318 0 .534-.216A.73.73 0 0 0 17.75 7a.73.73 0 0 0-.216-.535A.73.73 0 0 0 17 6.25H7a.73.73 0 0 0-.534.216A.73.73 0 0 0 6.25 7q0 .32.216.535A.73.73 0 0 0 7 7.75'
      />
    </G>
  </Svg>
);
export default SvgComponent;
