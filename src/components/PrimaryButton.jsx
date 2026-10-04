import Button from './ui/Button'

/** @deprecated Prefer `<Button variant="primary" />` */
export default function PrimaryButton({ surface = 'light', size = 'md', ...props }) {
  return <Button variant="primary" surface={surface} size={size} {...props} />
}
