import { useNavigate } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import CatalogueView from '../components/CatalogueView'
import PageContainer from '../components/PageContainer'
import { usePageTitle } from '../hooks/usePageTitle'
import { cataloguePath } from '../utils/catalogueRoutes'

export default function Catalogue() {
  usePageTitle('Crackers catalogue')
  const navigate = useNavigate()

  return (
    <PageContainer>
      <CatalogueView
        categorySlug="all"
        onCategoryChange={(slug) => navigate(cataloguePath(slug))}
        pageTitle="Crackers"
        pageDescription="The festive collection."
        kicker=""
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Crackers' }]} editorial />
        }
      />
    </PageContainer>
  )
}
