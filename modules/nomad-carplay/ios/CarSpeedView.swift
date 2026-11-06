// The speed on the car's map, as the phone's SpeedBadge draws it: the posted limit as a round sign
// (white, red ring, black figures) above the GPS speed in a dark panel that turns red past the limit.
// JS works out the numbers (carplay-core's carSpeed); this only draws them. It sits at the top
// left of the map template's safe area, out of the system's panels and buttons: purely visual and
// never touchable, which is what Apple allows over a navigation app's map (DTS on the developer
// forums, thread 852888: a speed indicator and a speed limit sign are "standard practice").
import CoreText
import UIKit

/** The phone's sign and panel colours (src/theme/tokens.ts): keep them in step. */
private enum SpeedColors {
  static let signFace = CarColors.hex(0xFFFFFF)
  static let signRing = CarColors.hex(0xD93D42)
  static let signText = CarColors.hex(0x18171B)
  static let text = CarColors.hex(0xF2F2EF)
  static let textSecondary = CarColors.hex(0x8F8F89)
  static let border = CarColors.hex(0x232323)
  static let danger = CarColors.hex(0xFF453A)
  static let dangerSoft = CarColors.hex(0x3A1513)
}

final class CarSpeedView: UIView {
  private static let sign: CGFloat = 42

  private let signView = UIView()
  private let limitLabel = UILabel()
  private let panel = UIView()
  private let valueLabel = UILabel()
  private let unitLabel = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false

    signView.backgroundColor = SpeedColors.signFace
    signView.layer.cornerRadius = Self.sign / 2
    signView.layer.borderWidth = 5
    signView.layer.borderColor = SpeedColors.signRing.cgColor
    limitLabel.font = Self.font("ChakraPetch-Bold", 18, .heavy)
    limitLabel.textColor = SpeedColors.signText
    limitLabel.textAlignment = .center
    limitLabel.adjustsFontSizeToFitWidth = true
    limitLabel.minimumScaleFactor = 0.6

    panel.backgroundColor = CarColors.surface
    panel.layer.borderWidth = 1
    panel.layer.borderColor = SpeedColors.border.cgColor
    panel.layer.shadowColor = UIColor.black.cgColor
    panel.layer.shadowOpacity = 0.5
    panel.layer.shadowRadius = 8
    panel.layer.shadowOffset = CGSize(width: 0, height: 3)
    valueLabel.font = Self.font("ChakraPetch-SemiBold", 19, .semibold)
    valueLabel.textAlignment = .center
    unitLabel.font = Self.font("IBMPlexSans-Medium", 11, .medium)
    unitLabel.textAlignment = .center

    let numbers = UIStackView(arrangedSubviews: [valueLabel, unitLabel])
    numbers.axis = .vertical
    numbers.alignment = .center
    numbers.spacing = -2
    let stack = UIStackView(arrangedSubviews: [signView, panel])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 6
    for v in [limitLabel, numbers, stack] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
    signView.addSubview(limitLabel)
    panel.addSubview(numbers)
    addSubview(stack)
    NSLayoutConstraint.activate([
      signView.widthAnchor.constraint(equalToConstant: Self.sign),
      signView.heightAnchor.constraint(equalToConstant: Self.sign),
      limitLabel.centerXAnchor.constraint(equalTo: signView.centerXAnchor),
      limitLabel.centerYAnchor.constraint(equalTo: signView.centerYAnchor),
      limitLabel.widthAnchor.constraint(equalTo: signView.widthAnchor, constant: -12),
      panel.widthAnchor.constraint(greaterThanOrEqualToConstant: 50),
      numbers.topAnchor.constraint(equalTo: panel.topAnchor, constant: 3),
      numbers.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -3),
      numbers.leadingAnchor.constraint(greaterThanOrEqualTo: panel.leadingAnchor, constant: 8),
      numbers.trailingAnchor.constraint(lessThanOrEqualTo: panel.trailingAnchor, constant: -8),
      numbers.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
      stack.topAnchor.constraint(equalTo: topAnchor),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
    isHidden = true
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  func show(_ speed: CarSpeed?) {
    guard let speed else {
      isHidden = true
      return
    }
    isHidden = false
    signView.isHidden = speed.limit == nil
    if let limit = speed.limit { limitLabel.text = String(limit) }
    valueLabel.text = String(speed.value)
    unitLabel.text = speed.unit
    valueLabel.textColor = speed.over ? SpeedColors.danger : SpeedColors.text
    unitLabel.textColor = speed.over ? SpeedColors.danger : SpeedColors.textSecondary
    panel.backgroundColor = speed.over ? SpeedColors.dangerSoft : CarColors.surface
    panel.layer.borderColor = (speed.over ? SpeedColors.danger : SpeedColors.border).cgColor
  }

  private static func font(_ name: String, _ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
    // The app's fonts are in the bundle (UIAppFonts); the system's tabular figures if one is missing.
    let font = UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight)
    return font.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
  }
}

private extension UIFont {
  func addingAttributes(_ attributes: [UIFontDescriptor.AttributeName: Any]) -> UIFont {
    UIFont(descriptor: fontDescriptor.addingAttributes(attributes), size: pointSize)
  }
}
