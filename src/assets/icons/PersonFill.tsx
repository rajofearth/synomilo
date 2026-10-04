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
        d='M12 11.692q-1.448 0-2.474-1.026A3.37 3.37 0 0 1 8.5 8.192q0-1.448 1.026-2.474A3.37 3.37 0 0 1 12 4.692q1.448 0 2.474 1.026A3.37 3.37 0 0 1 15.5 8.192q0 1.449-1.026 2.474A3.37 3.37 0 0 1 12 11.692m-7.5 6.096v-.704q0-.735.399-1.36a2.66 2.66 0 0 1 1.066-.963 14.5 14.5 0 0 1 2.992-1.09 12.95 12.95 0 0 1 6.086 0q1.509.364 2.992 1.09.667.337 1.066.963t.399 1.36v.704q0 .633-.443 1.076a1.47 1.47 0 0 1-1.076.444H6.019q-.632 0-1.076-.444a1.47 1.47 0 0 1-.443-1.076'
      />
    </G>
  </Svg>
);
export default SvgComponent;
