import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import CatalogueView from '../components/CatalogueView'
import PageContainer from '../components/PageContainer'
import { usePageTitle } from '../hooks/usePageTitle'
import { isValidCategorySlug } from '../utils/categoryCounts'
import { getCategoryLabelFromSlug } from '../utils/filterProducts'
import { cataloguePath } from '../utils/catalogueRoutes'

export default function Category() {
  const { categorySlug } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const valid = isValidCategorySlug(categorySlug)
  const label = valid ? getCategoryLabelFromSlug(categorySlug) : ''
  usePageTitle(valid ? label : 'Page not found')

  if (!valid) {
    return <Navigate to="/404" replace />
  }

  const handleCategoryChange = (slug) => {
    const budget = searchParams.get('budget')
    navigate(cataloguePath(slug, budget))
  }

  return (
    <PageContainer>
      <CatalogueView
        categorySlug={categorySlug}
        onCategoryChange={handleCategoryChange}
        pageTitle={label}
        pageDescription="From our festive collection."
        kicker="Crackers"
        breadcrumbs={
          <Breadcrumbs
            editorial
            items={[
              { label: 'Home', to: '/' },
              { label: 'Crackers', to: '/crackers' },
              { label: label },
            ]}
          />
        }
      />
    </PageContainer>
  )
}
