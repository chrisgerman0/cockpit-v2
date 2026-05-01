import { Activity, Bell, Bot, LineChart, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChartCard } from '@/components/cockpit/ChartCard'
import { DashboardMockup } from '@/components/cockpit/DashboardMockup'
import { EmptyState } from '@/components/cockpit/EmptyState'
import { EquityChart } from '@/components/cockpit/EquityChart'
import { LeverageGauge } from '@/components/cockpit/LeverageGauge'
import { PageHeader } from '@/components/cockpit/PageHeader'
import { SkeletonLoader } from '@/components/cockpit/SkeletonLoader'
import { StatTile } from '@/components/cockpit/StatTile'
import { StreakDots } from '@/components/cockpit/StreakDots'
import { equityData } from '@/components/cockpit/mock-data'

export default function DesignReferencePage() {
  return (
    <div className="px-4 py-6 pb-20 sm:px-5">
      <PageHeader title="Design System" subtitle="Obsidian Ledger components rendered in both themes for regression checks." />
      <div className="grid gap-4 xl:grid-cols-2">
        <ThemeColumn theme="dark" />
        <ThemeColumn theme="light" />
      </div>
      <Separator className="my-8" />
      <PageHeader title="Dashboard Composition" subtitle="Full composition using the same component primitives." />
      <DashboardMockup includeTicker={false} />
    </div>
  )
}

function ThemeColumn({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section className={`${theme} rounded-lg border border-border bg-background p-4 text-foreground`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize">{theme} Theme</h2>
        <Badge variant="accent">Obsidian Ledger</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label="Bot Status" value="Active" caption="Watching" icon={Bot} variant="positive" />
        <StatTile label="Total Return" value="+4,438%" caption="All time" icon={LineChart} variant="accent" />
        <StatTile label="Unrealized PNL" value="$0" caption="No open position" icon={Activity} variant="positive" />
        <StatTile label="Alerts" value="0" caption="No action needed" icon={Bell} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ChartCard title="Equity Curve" range="6M" periodLabel="6M performance">
          <EquityChart data={equityData} />
        </ChartCard>
        <div className="space-y-3">
          <LeverageGauge value={7.5} />
          <Card>
            <CardHeader>
              <CardTitle>Primitive Sweep</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Toggle pressed>Toggle</Toggle>
              </div>
              <Tabs defaultValue="one">
                <TabsList>
                  <TabsTrigger value="one">One</TabsTrigger>
                  <TabsTrigger value="two">Two</TabsTrigger>
                </TabsList>
                <TabsContent value="one">Tab content renders cleanly.</TabsContent>
                <TabsContent value="two">Second tab content.</TabsContent>
              </Tabs>
              <div className="grid gap-2">
                <Label htmlFor={`${theme}-input`}>Input</Label>
                <Input id={`${theme}-input`} placeholder="Limit price" />
              </div>
              <Select defaultValue="btc">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="btc">BTCUSDT</SelectItem>
                  <SelectItem value="eth">ETHUSDT</SelectItem>
                </SelectContent>
              </Select>
              <Progress value={62} />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild><Button variant="ghost">Tooltip</Button></TooltipTrigger>
                  <TooltipContent>Premium cockpit tooltip</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <StreakDots results={['W', 'W', 'L', 'W', 'W', 'L', 'W']} />
              <Skeleton className="h-8 w-full" />
              <SkeletonLoader />
              <EmptyState />
              <div className="flex items-center gap-2 text-sm text-positive"><ShieldCheck className="h-4 w-4" /> Accessible focus states included</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
