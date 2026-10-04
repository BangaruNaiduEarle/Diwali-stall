import Button from './ui/Button'

/** @deprecated Prefer `<Button variant="secondary" />` */
export default function SecondaryButton({ surface = 'light', size = 'md', ...props }) {
  return <Button variant="secondary" surface={surface} size={size} {...props} />
}
