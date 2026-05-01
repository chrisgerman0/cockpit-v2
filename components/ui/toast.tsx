'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const ToastProvider = ToastPrimitive.Provider
export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport ref={ref} className={cn('fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-sm', className)} {...props} />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Root ref={ref} className={cn('group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border bg-popover p-4 text-popover-foreground shadow-cockpit', className)} {...props} />
))
Toast.displayName = ToastPrimitive.Root.displayName

export const ToastAction = ToastPrimitive.Action
export const ToastTitle = ToastPrimitive.Title
export const ToastDescription = ToastPrimitive.Description
export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close ref={ref} className={cn('rounded-md p-1 text-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100', className)} {...props}>
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName
