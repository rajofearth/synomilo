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
        d='M19.44 20.5q-2.827 0-5.68-1.314t-5.246-3.709q-2.385-2.395-3.7-5.242Q3.5 7.386 3.5 4.56A1.034 1.034 0 0 1 4.55 3.5h3.262q.378 0 .668.247t.368.61L9.421 7.3q.06.41-.025.704-.084.293-.304.494l-2.31 2.248q.558 1.02 1.275 1.932.716.91 1.55 1.74a17.2 17.2 0 0 0 3.753 2.842l2.244-2.264q.235-.245.568-.342.334-.099.694-.048l2.776.565q.38.1.619.387.24.285.239.65v3.242q0 .45-.305.75t-.755.3'
      />
    </G>
  </Svg>
);
export default SvgComponent;
