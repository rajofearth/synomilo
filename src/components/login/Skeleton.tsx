import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, useColorScheme, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
// import { useThemeInternal } from "../../../theme/hook";

const { width: screenWidth } = Dimensions.get("window");

const SkeletonBox = ({ index, boxSize, gradientColors }: any) => {
  // Determine if the box is the last in its row
  const isLastInRow = (index + 1) % 3 === 0;

  return (
    <Svg
      height={boxSize}
      width={boxSize}
      viewBox="0 0 100 100"
      fill="none"
      style={[
        styles.skeletonBox,
        {
          width: boxSize,
          height: boxSize,
          marginRight: isLastInRow ? 0 : 8,
        },
      ]}
    >
      <Defs>
        <LinearGradient
          id={`paint0_linear_${index}`}
          x1={10}
          y1={50}
          x2={90}
          y2={50}
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor={gradientColors[0]} />
          <Stop offset={1} stopColor={gradientColors[1]} />
        </LinearGradient>
      </Defs>
      <Rect
        x={10}
        y={10}
        width={80}
        height={80}
        rx={15}
        ry={15}
        fill={`url(#paint0_linear_${index})`}
      />
    </Svg>
  );
};

export const Skeleton = () => {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const mode = useColorScheme();

  // Define static colors
  const color = {
    staticBlack: "#000000",
    staticWhite: "#FFFFFF",
  };

  // Define skeletonStyle based on the theme mode
  const skeletonStyle =
    mode === "light"
      ? {
          linearGradientColors: ["#E8E8E8", "#F5F5F5"],
          shimmerBackgroundColor: color.staticBlack,
          shimmerOpacity: 0.01,
          speed: 1,
        }
      : {
          linearGradientColors: ["#383838", "#272727"],
          shimmerBackgroundColor: color.staticWhite,
          shimmerOpacity: 0.01,
          speed: 1,
        };

  const { linearGradientColors, shimmerBackgroundColor, shimmerOpacity, speed } =
    skeletonStyle;

  useEffect(() => {
    animatedValue.setValue(0);
    /**
     * `Animated.loop(...).start()` returns a handle that has to be stopped on unmount.
     * Without it the loop keeps driving a native animation for a screen that is gone, and
     * every visit stacked another one on top.
     *
     * There is also no artificial "simulate 3 seconds of loading" timer any more: it was a
     * fixed delay that hid real content on a fast connection, and on a failed fetch it
     * ended with `return null` while the caller still believed the skeleton was showing —
     * a permanent grey box. The caller decides when loading is done; this just renders
     * while it is.
     */
    const shimmer = Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: (1 / speed) * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    shimmer.start();

    return () => {
      shimmer.stop();
    };
  }, [animatedValue, speed]);

  const shimmerTranslateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth, screenWidth],
  });

  const boxSize = (screenWidth - 22) / 3;
  const shimmerWidth = screenWidth;
  const shimmerHeight = boxSize + 16;

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {new Array(6).fill(0).map((_, index) => (
          <SkeletonBox
            key={index}
            index={index}
            boxSize={boxSize}
            gradientColors={linearGradientColors}
          />
        ))}
      </View>
      <Animated.View
        style={[
          styles.animatedShimmer,
          {
            width: shimmerWidth,
            height: shimmerHeight,
            transform: [{ translateX: shimmerTranslateX }],
            backgroundColor: shimmerBackgroundColor,
            opacity: shimmerOpacity,
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
    borderRadius: 16,
    overflow: "hidden",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  skeletonBox: {
    marginBottom: 10,
    marginHorizontal: -10,
  },
  animatedShimmer: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});

export default Skeleton;
