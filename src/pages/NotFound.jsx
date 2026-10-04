import { AlertCircle } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageContainer from '../components/PageContainer'
import Button from '../components/ui/Button'
import { usePageTitle } from '../hooks/usePageTitle'

export default function NotFound() {
  usePageTitle('Page not found')

  return (
    <PageContainer>
      <EmptyState
        icon={AlertCircle}
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
            <Button to="/crackers" variant="primary" fullWidth className="sm:!w-auto">
              Browse crackers
            </Button>
            <Button to="/" variant="secondary" fullWidth className="sm:!w-auto">
              Go home
            </Button>
          </div>
        }
      />
    </PageContainer>
  )
}
