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
        d='M12 8.25q2.864 0 5.649 1.149a14.15 14.15 0 0 1 4.876 3.332q.308.31.314.724a.95.95 0 0 1-.305.714l-1.905 1.856q-.305.294-.681.329a1 1 0 0 1-.696-.2l-2.516-1.912a1.3 1.3 0 0 1-.367-.417 1.1 1.1 0 0 1-.12-.517v-2.822a15 15 0 0 0-2.113-.552A12 12 0 0 0 12 9.75q-1.107 0-2.137.184-1.029.186-2.113.553v2.82q0 .289-.12.518-.118.229-.367.417l-2.515 1.912a1 1 0 0 1-.696.2 1.1 1.1 0 0 1-.681-.329l-1.906-1.856a.95.95 0 0 1-.305-.714 1 1 0 0 1 .315-.724 14 14 0 0 1 4.868-3.332Q9.136 8.25 12 8.25'
      />
    </G>
  </Svg>
);
export default SvgComponent;
