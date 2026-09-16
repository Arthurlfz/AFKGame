import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/* ============================================================
 * 永夜灵市 · 片头（Opening）
 * 定调与游戏一致：古典水墨 + 羊皮纸做旧，墨黑底、枯金点缀、朱印收尾。
 * 节奏：墨点晕开 → 竖排书名落款 → 英文名与副题 → 朱印钤记 → 淡出。
 * 配色表与 docs/css/design-tokens.css 同源（这里的值就是那几张 token）。
 * ============================================================ */
const INK = '#080b0c';       // --bg-deep
const PAPER = '#ece6d2';     // --text-hi
const GOLD = '#e0c77d';      // --accent-hi
const GOLD_DIM = '#806b3e';  // --accent-dim
const MIST = '#899694';      // --mist
const SEAL = '#963d3d';      // --danger
const SEAL_HI = '#c76559';   // --danger-hi

const FONT_TITLE = '"STKaiti", "KaiTi", "FZKai-Z03", "Microsoft YaHei", serif';
const FONT_BODY = '"Microsoft YaHei", "PingFang SC", sans-serif';

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // 墨点：从中心晕开（0.0~2.0s），随后一直缓慢扩散
  const ink = interpolate(frame, [0, 60, durationInFrames], [0, 0.55, 1], {
    extrapolateRight: 'clamp',
  });
  const inkR = ink * Math.max(width, height) * 2.1;
  const inkOpacity = interpolate(frame, [0, 24, 150, 239], [0, 0.95, 0.9, 0.72], {
    extrapolateRight: 'clamp',
  });

  // 竖排书名：1.3s 落款
  const titleSpring = spring({ frame: frame - 39, fps, config: { damping: 15, stiffness: 70 } });
  const titleOpacity = interpolate(frame, [39, 72], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 英文名 + 副题：3.7s / 4.3s
  const subOpacity = interpolate(frame, [111, 148], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lineWidth = interpolate(frame, [111, 152], [0, 72], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 朱印：4.5s 钤记
  const sealSpring = spring({ frame: frame - 135, fps, config: { damping: 11, stiffness: 120 } });

  // 整体淡出（最后 0.8s）
  const fade = interpolate(frame, [durationInFrames - 24, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: INK, opacity: fade, fontFamily: FONT_BODY }}>
      {/* 墨晕（背景层） */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: inkR,
            height: inkR,
            borderRadius: '50%',
            opacity: inkOpacity,
            background: `radial-gradient(circle,
              rgba(150,61,61,.32) 0%,
              rgba(24,32,33,.92) 42%,
              rgba(8,11,12,.98) 68%,
              rgba(8,11,12,1) 100%)`,
            filter: 'blur(3px)',
          }}
        />
      </AbsoluteFill>

      {/* 一层极淡的纸纹噪点，避免大色块看起来"塑料" */}
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* 主内容：竖排书名 + 英文名 + 副题 */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          gap: 34,
        }}
      >
        <div
          style={{
            writingMode: 'vertical-rl',
            fontFamily: FONT_TITLE,
            fontWeight: 700,
            fontSize: 148,
            letterSpacing: 26,
            color: PAPER,
            opacity: titleOpacity,
            transform: `translateY(${(1 - titleSpring) * 30}px)`,
            textShadow: `0 2px 0 rgba(0,0,0,.75), 0 -1px 0 rgba(236,230,210,.06), 0 0 42px rgba(224,199,125,.20)`,
          }}
        >
          永夜灵市
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: subOpacity }}>
          <span style={{ width: lineWidth, height: 1, background: GOLD_DIM }} />
          <span style={{ fontSize: 27, letterSpacing: 9, color: GOLD, whiteSpace: 'nowrap' }}>
            EVERNIGHT BAZAAR
          </span>
          <span style={{ width: lineWidth, height: 1, background: GOLD_DIM }} />
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 23,
            letterSpacing: 10,
            color: MIST,
            opacity: subOpacity,
            whiteSpace: 'nowrap',
          }}
        >
          挂机养宠 · 打造装备 · 玩家交易
        </div>
      </AbsoluteFill>

      {/* 右下朱印（钤记） */}
      <div
        style={{
          position: 'absolute',
          right: '11%',
          bottom: '13%',
          width: 104,
          height: 104,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `3px solid ${SEAL}`,
          boxShadow: `inset 0 0 0 1px rgba(199,101,89,.35)`,
          borderRadius: 4,
          color: SEAL_HI,
          fontFamily: FONT_TITLE,
          fontWeight: 700,
          fontSize: 32,
          lineHeight: 1.06,
          letterSpacing: 3,
          textAlign: 'center',
          opacity: subOpacity,
          transform: `scale(${sealSpring}) rotate(-5deg)`,
        }}
      >
        永夜
        <br />
        灵市
      </div>
    </AbsoluteFill>
  );
};
