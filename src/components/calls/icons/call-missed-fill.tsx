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
        d='M5 10.021v4.181a.73.73 0 0 1-.215.534.73.73 0 0 1-.535.216.73.73 0 0 1-.534-.216.73.73 0 0 1-.216-.534V8.356q0-.387.259-.645a.88.88 0 0 1 .645-.259h5.846q.32 0 .534.215a.73.73 0 0 1 .216.535.73.73 0 0 1-.216.535.73.73 0 0 1-.534.215H6.054l5.773 5.773a.3.3 0 0 0 .221.087.3.3 0 0 0 .221-.087l6.66-6.66a.7.7 0 0 1 .522-.22q.3.003.532.236.217.232.225.527a.7.7 0 0 1-.225.527l-6.654 6.654q-.27.27-.608.401a1.9 1.9 0 0 1-.673.131q-.337 0-.673-.13a1.75 1.75 0 0 1-.608-.402z'
      />
    </G>
  </Svg>
);
export default SvgComponent;
